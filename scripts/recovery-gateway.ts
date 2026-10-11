import { createPublicKey, type KeyObject, randomUUID } from 'node:crypto';
import {
  ADMISSION_CHALLENGE,
  ADMISSION_RESPONSE,
  createAdmissionGateway,
  createAdmissionGuard,
} from '../src/server/erasure/admission';
import {
  type Signed,
  verifyValue,
} from '../src/server/erasure/journal-contract';
import type {
  AdmissionAttestation,
  AdmissionResponse,
} from '../src/server/erasure/recovery-control';
import { protectedExternalPath, readProtected } from './lib/artifacts';
import {
  createGatewayDatabase,
  type GatewayDatabaseConfiguration,
} from './lib/gateway-database';

interface Configuration {
  port: number;
  primary: GatewayDatabaseConfiguration;
  journal: string;
  token: string;
  epoch: string;
  keys: Record<string, string>;
  upstream: string;
  publicOrigin: string;
  upstreamProtection?: UpstreamProtection;
}
interface UpstreamProtection {
  provider: 'vercel';
  token: string;
}
const providerControl = (name: string) =>
  name.toLowerCase().startsWith('x-vercel-') || /^_*vercel(?:_|-)/i.test(name);
const requestHeaders = (request: Request) => {
  const headers = new Headers(request.headers);
  const hop =
    headers
      .get('connection')
      ?.split(',')
      .map((name) => name.trim()) ?? [];
  for (const name of [...headers.keys()])
    if (providerControl(name) || name.toLowerCase().startsWith('x-middleware-'))
      headers.delete(name);
  for (const name of [
    ...hop,
    'connection',
    'transfer-encoding',
    'keep-alive',
    'upgrade',
    'te',
    'trailer',
    'proxy-authorization',
    'proxy-authenticate',
    'forwarded',
  ])
    if (name) headers.delete(name);
  const cookie = headers.get('cookie');
  if (cookie) {
    const kept = cookie
      .split(';')
      .filter((part) => !providerControl(part.split('=', 1)[0].trim()))
      .join(';');
    if (kept.trim()) headers.set('cookie', kept);
    else headers.delete('cookie');
  }
  return headers;
};

export function recoveryForwarder(
  upstream: string,
  publicOrigin: string,
  keys: ReadonlyMap<string, KeyObject>,
  fetcher = fetch,
  protection?: UpstreamProtection,
) {
  const origin = new URL(upstream);
  const publicUrl = new URL(publicOrigin);
  for (const url of [origin, publicUrl])
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Gateway origin refused');
  if (
    origin.protocol !== 'https:' &&
    !['127.0.0.1', '[::1]'].includes(origin.hostname)
  )
    throw new Error('Gateway upstream refused');
  if (
    protection !== undefined &&
    (!protection ||
      Object.keys(protection).sort().join(',') !== 'provider,token' ||
      protection.provider !== 'vercel' ||
      typeof protection.token !== 'string' ||
      !/^[\x21-\x7e]{32,512}$/.test(protection.token) ||
      origin.protocol !== 'https:' ||
      !origin.hostname.endsWith('.vercel.app') ||
      origin.port)
  )
    throw new Error('Gateway upstream protection refused');
  const secret = protection?.token;
  return async (request: Request, admitted: AdmissionAttestation) => {
    const incoming = new URL(request.url);
    const target = new URL(origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    for (const name of [...target.searchParams.keys()])
      if (providerControl(name)) target.searchParams.delete(name);
    const headers = requestHeaders(request);
    const nonce = randomUUID();
    headers.set(ADMISSION_CHALLENGE, nonce);
    headers.delete(ADMISSION_RESPONSE);
    headers.set('accept-encoding', 'identity');
    headers.set('host', secret ? origin.host : publicUrl.host);
    headers.set('x-forwarded-host', publicUrl.host);
    headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));
    if (secret) headers.set('x-vercel-protection-bypass', secret);
    const response = await fetcher(target, {
      method: request.method,
      headers,
      ...(request.method !== 'GET' && request.method !== 'HEAD'
        ? { body: request.body, duplex: 'half' }
        : {}),
      redirect: 'manual',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    try {
      const encoded = response.headers.get(ADMISSION_RESPONSE);
      if (!encoded || encoded.length > 8192) throw new Error();
      const proof = verifyValue(
        JSON.parse(
          Buffer.from(encoded, 'base64url').toString(),
        ) as Signed<AdmissionResponse>,
        keys,
      );
      if (
        proof.purpose !== 'admission-response' ||
        proof.nonce !== nonce ||
        proof.runId !== admitted.runId ||
        proof.incarnation !== admitted.incarnation ||
        proof.writerEpoch !== admitted.writerEpoch
      )
        throw new Error();
      const output = new Headers(response.headers);
      if (
        secret &&
        [...output.values()].some(
          (value) =>
            value.includes(secret) ||
            value.includes(encodeURIComponent(secret)),
        )
      )
        throw new Error();
      const hop =
        output
          .get('connection')
          ?.split(',')
          .map((name) => name.trim()) ?? [];
      for (const header of [...output.keys()])
        if (providerControl(header)) output.delete(header);
      for (const header of [
        ...hop,
        ADMISSION_RESPONSE,
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection',
        'keep-alive',
        'upgrade',
        'te',
        'trailer',
        'proxy-authenticate',
      ])
        if (header) output.delete(header);
      output.delete('set-cookie');
      for (const cookie of response.headers.getSetCookie())
        if (!providerControl(cookie.split('=', 1)[0].trim()))
          output.append('set-cookie', cookie);
      const location = output.get('location');
      if (location) {
        const destination = new URL(location, publicUrl);
        if ([...destination.searchParams.keys()].some(providerControl))
          throw new Error();
        if (destination.origin === origin.origin)
          output.set(
            'location',
            `${publicUrl.origin}${destination.pathname}${destination.search}${destination.hash}`,
          );
      }
      for (const header of [
        'cache-control',
        'cdn-cache-control',
        'vercel-cdn-cache-control',
      ])
        output.set(header, 'private, no-store');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: output,
      });
    } catch {
      await response.body?.cancel().catch(() => {});
      throw new Error('Upstream admission unavailable');
    }
  };
}
async function main(path: string) {
  const config = readProtected(
    protectedExternalPath(path, new URL('../', import.meta.url)),
    64 * 1024,
  ) as Configuration;
  if (
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error();
  const sql = createGatewayDatabase(config.primary);
  try {
    const keys = new Map(
      Object.entries(config.keys).map(([id, pem]) => [
        id,
        createPublicKey(pem),
      ]),
    );
    const assert = createAdmissionGuard({
      sql,
      url: config.journal,
      token: config.token,
      epoch: config.epoch,
      keys,
    });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: config.port,
      fetch: createAdmissionGateway(
        assert,
        recoveryForwarder(
          config.upstream,
          config.publicOrigin,
          keys,
          fetch,
          config.upstreamProtection,
        ),
      ),
    });
    const stop = async () => {
      await server.stop(true);
      await sql.end({ timeout: 5 });
    };
    process.once('SIGTERM', () => {
      void stop();
    });
    process.once('SIGINT', () => {
      void stop();
    });
    console.log(`Recovery gateway listening on loopback port ${server.port}`);
  } catch {
    await sql.end({ timeout: 5 });
    throw new Error();
  }
}
if (import.meta.main) {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) {
    console.error('Usage: recovery-gateway.ts CONFIG');
    process.exitCode = 1;
  } else
    void main(path).catch(() => {
      console.error('Recovery gateway startup refused');
      process.exitCode = 1;
    });
}
