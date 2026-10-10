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
}
export function recoveryForwarder(
  upstream: string,
  publicOrigin: string,
  keys: ReadonlyMap<string, KeyObject>,
  fetcher = fetch,
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
  return async (request: Request, admitted: AdmissionAttestation) => {
    const incoming = new URL(request.url);
    const target = new URL(origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    const nonce = randomUUID();
    headers.set(ADMISSION_CHALLENGE, nonce);
    headers.delete(ADMISSION_RESPONSE);
    headers.set('accept-encoding', 'identity');
    headers.set('host', publicUrl.host);
    headers.set('x-forwarded-host', publicUrl.host);
    headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));
    headers.delete('connection');
    headers.delete('transfer-encoding');
    headers.delete('forwarded');
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
    } catch {
      await response.body?.cancel().catch(() => {});
      throw new Error('Upstream admission unavailable');
    }
    const output = new Headers(response.headers);
    for (const header of [
      ADMISSION_RESPONSE,
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'connection',
    ])
      output.delete(header);
    const location = output.get('location');
    if (location) {
      const destination = new URL(location, publicUrl);
      if (destination.origin === origin.origin)
        output.set(
          'location',
          `${publicUrl.origin}${destination.pathname}${destination.search}${destination.hash}`,
        );
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: output,
    });
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
        recoveryForwarder(config.upstream, config.publicOrigin, keys),
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
