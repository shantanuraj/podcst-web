import { afterAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADMISSION_CHALLENGE,
  ADMISSION_RESPONSE,
  createAdmissionGateway,
} from '../src/server/erasure/admission';
import {
  JOURNAL_GENESIS,
  signValue,
} from '../src/server/erasure/journal-contract';
import type { AdmissionAttestation } from '../src/server/erasure/recovery-control';
import { createTLSFixture } from './lib/tls-fixture';
import { recoveryForwarder } from './recovery-gateway';

const pair = generateKeyPairSync('ed25519');
const keys = new Map([['synthetic', pair.publicKey]]);
const protection = {
  provider: 'vercel' as const,
  token: randomBytes(32).toString('base64url'),
};
const base = { journalId: randomUUID(), sequence: '0', hash: JOURNAL_GENESIS };
const proof: AdmissionAttestation = {
  version: 1,
  purpose: 'recovery-admission',
  artifactHash: null,
  runId: randomUUID(),
  incarnation: randomUUID(),
  writerEpoch: randomUUID(),
  authEpoch: randomUUID(),
  generation: randomUUID(),
  database: {
    database: 'synthetic',
    oid: '1',
    cluster: '1',
    startedAt: new Date().toISOString(),
  },
  role: 'synthetic',
  redisIdentity: 'a'.repeat(40),
  schemaHash: 'b'.repeat(64),
  catalogHash: 'c'.repeat(64),
  base,
  head: { ...base, epoch: randomUUID(), revision: '0', sealed: false },
};
const origin = 'https://synthetic.vercel.app';
const publicOrigin = 'https://example.invalid';
const signedResponse = (
  request: Request,
  response = new Response('private'),
) => {
  response.headers.set(
    ADMISSION_RESPONSE,
    Buffer.from(
      JSON.stringify(
        signValue(
          {
            purpose: 'admission-response',
            nonce: request.headers.get(ADMISSION_CHALLENGE),
            runId: proof.runId,
            incarnation: proof.incarnation,
            writerEpoch: proof.writerEpoch,
          },
          'synthetic',
          pair.privateKey,
        ),
      ),
    ).toString('base64url'),
  );
  return response;
};
const fetcher = (respond: (request: Request) => Response | Promise<Response>) =>
  (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => respond(new Request(input, init))) as typeof fetch;
const gateway = (respond: (request: Request) => Response | Promise<Response>) =>
  createAdmissionGateway(
    async () => proof,
    recoveryForwarder(origin, publicOrigin, keys, fetcher(respond), protection),
  );

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories)
    rmSync(directory, { recursive: true, force: true });
});

describe('protected upstream gateway', () => {
  test('only the protected header supplies the provider credential; client bypass controls are removed', async () => {
    let received: Request | undefined;
    const forward = gateway((request) => {
      received = request;
      return signedResponse(request);
    });
    const request = new Request(
      `${publicOrigin}/api/private?keep=1&x-vercel-protection-bypass=client&X-VERCEL-SET-BYPASS-COOKIE=true&_vercel_share=client`,
      {
        headers: {
          'x-vercel-protection-bypass': 'client',
          'x-vercel-set-bypass-cookie': 'true',
          'x-middleware-subrequest': 'proxy',
          'x-middleware-override-headers': 'host',
          cookie: 'session=kept; _vercel_jwt=client; region=us',
          forwarded: 'host=attacker.invalid',
          'x-forwarded-host': 'attacker.invalid',
        },
      },
    );
    expect((await forward(request)).status).toBe(200);
    expect(received?.url).toBe(`${origin}/api/private?keep=1`);
    expect(received?.headers.get('host')).toBe('synthetic.vercel.app');
    expect(received?.headers.get('x-forwarded-host')).toBe('example.invalid');
    expect(received?.headers.get('x-forwarded-proto')).toBe('https');
    expect(received?.headers.get('x-vercel-protection-bypass')).toBe(
      protection.token,
    );
    for (const name of [
      'x-vercel-set-bypass-cookie',
      'x-middleware-subrequest',
      'x-middleware-override-headers',
      'forwarded',
    ])
      expect(received?.headers.has(name)).toBe(false);
    expect(received?.headers.get('cookie')).toBe('session=kept; region=us');
    expect(received?.url).not.toContain(protection.token);
  });

  test('an unprotected loopback origin still strips provider controls and receives no bypass secret', async () => {
    const forward = recoveryForwarder(
      'http://127.0.0.1:3000',
      publicOrigin,
      keys,
      fetcher((request) => {
        expect(request.headers.has('x-vercel-protection-bypass')).toBe(false);
        expect(request.headers.get('host')).toBe('example.invalid');
        expect(request.headers.get('cookie')).toBe('session=kept');
        expect(new URL(request.url).search).toBe('');
        return signedResponse(request);
      }),
    );
    expect(
      (
        await forward(
          new Request(`${publicOrigin}/?%78-vercel-set-bypass-cookie=true`, {
            headers: {
              'x-vercel-protection-bypass': 'client',
              cookie: '_vercel_jwt=bad;session=kept',
            },
          }),
          proof,
        )
      ).status,
    ).toBe(200);
  });

  test('provider cookies and proof headers never reach the browser; authenticated output is not cacheable', async () => {
    const forward = gateway((request) => {
      const response = signedResponse(request);
      response.headers.append(
        'set-cookie',
        '_vercel_jwt=provider-capability; Path=/; Secure; HttpOnly',
      );
      response.headers.append(
        'set-cookie',
        'session=current; Path=/; Secure; HttpOnly',
      );
      response.headers.append('set-cookie', 'region=us; Path=/');
      response.headers.set('x-vercel-set-bypass-cookie', 'true');
      response.headers.set('cache-control', 'public, max-age=86400');
      return response;
    });
    const response = await forward(new Request(publicOrigin));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      'session=current; Path=/; Secure; HttpOnly',
      'region=us; Path=/',
    ]);
    expect(response.headers.has(ADMISSION_RESPONSE)).toBe(false);
    expect(response.headers.has('x-vercel-set-bypass-cookie')).toBe(false);
    for (const name of [
      'cache-control',
      'cdn-cache-control',
      'vercel-cdn-cache-control',
    ])
      expect(response.headers.get(name)).toBe('private, no-store');
    expect(await response.text()).toBe('private');
  });

  test.each([
    'location',
    'set-cookie',
    'x-debug',
  ])('secret reflection in %s refuses and cancels the upstream body', async (header) => {
    let cancelled = false;
    const forward = gateway((request) => {
      const response = signedResponse(
        request,
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
      );
      response.headers.set(
        header,
        `https://example.invalid/?leak=${encodeURIComponent(protection.token)}`,
      );
      return response;
    });
    const response = await forward(new Request(publicOrigin));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(protection.token);
    expect(cancelled).toBe(true);
  });

  test('deployment redirects rewrite to the public origin but provider access links refuse', async () => {
    for (const [location, status] of [
      [`${origin}/library?tab=one`, 302],
      [`${origin}/?_vercel_share=provider-capability`, 503],
      [`${origin}/?x-vercel-set-bypass-cookie=true`, 503],
    ] as const) {
      const response = await gateway((request) =>
        signedResponse(
          request,
          new Response(null, { status: 302, headers: { location } }),
        ),
      )(new Request(publicOrigin));
      expect(response.status).toBe(status);
      if (status === 302)
        expect(response.headers.get('location')).toBe(
          `${publicOrigin}/library?tab=one`,
        );
    }
  });

  test('provider login redirects and stale cached proofs never release private bodies', async () => {
    let cached: Response | undefined;
    const forward = gateway((request) => {
      cached ??= signedResponse(request);
      return cached.clone();
    });
    expect((await forward(new Request(publicOrigin))).status).toBe(200);
    expect((await forward(new Request(publicOrigin))).status).toBe(503);
    const refused = gateway(
      () =>
        new Response('provider challenge', {
          status: 302,
          headers: { location: 'https://vercel.com/login' },
        }),
    );
    expect((await refused(new Request(publicOrigin))).status).toBe(503);
  });

  test('invalid configuration cannot send a provider secret to plaintext or unrelated hosts', () => {
    for (const upstream of [
      'http://127.0.0.1:3000',
      'https://attacker.invalid',
      'https://vercel.app.attacker.invalid',
      'https://synthetic.vercel.app:444',
    ])
      expect(() =>
        recoveryForwarder(upstream, publicOrigin, keys, fetch, protection),
      ).toThrow();
    for (const token of ['', 'short', `${protection.token}\r\nforged: header`])
      expect(() =>
        recoveryForwarder(origin, publicOrigin, keys, fetch, {
          ...protection,
          token,
        }),
      ).toThrow();
  });

  test.skipIf(!Bun.which('openssl'))(
    'real HTTPS transport carries only the server header and preserves streamed request/response data',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'podcst-upstream-tls-'));
      directories.push(directory);
      const tls = createTLSFixture(directory);
      const upstream = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        tls: { cert: Bun.file(tls.server.cert), key: Bun.file(tls.server.key) },
        async fetch(request) {
          expect(request.headers.get('x-vercel-protection-bypass')).toBe(
            protection.token,
          );
          expect(request.headers.has('x-vercel-set-bypass-cookie')).toBe(false);
          expect(await request.text()).toBe('synthetic request');
          return signedResponse(request, new Response('synthetic response'));
        },
      });
      try {
        const transport = (async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const target = new URL(String(input));
          const local = new URL(
            `${target.pathname}${target.search}`,
            `https://127.0.0.1:${upstream.port}`,
          );
          return fetch(local, {
            ...init,
            tls: { ca: readFileSync(tls.ca, 'utf8'), rejectUnauthorized: true },
          });
        }) as typeof fetch;
        const forward = recoveryForwarder(
          origin,
          publicOrigin,
          keys,
          transport,
          protection,
        );
        const response = await forward(
          new Request(`${publicOrigin}/api/private`, {
            method: 'POST',
            body: 'synthetic request',
          }),
          proof,
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('synthetic response');
      } finally {
        await upstream.stop(true);
      }
    },
    15_000,
  );
});
