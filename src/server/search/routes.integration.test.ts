import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Redis } from 'ioredis';

const executable = Bun.which('redis-server');
if (process.env.REQUIRE_LIST_LIMIT_TESTS === '1' && !executable)
  throw new Error('redis-server required for search route integration tests');

// Module replacements live in a child process, so other tests keep real SQL/fetch.
// Redis, source selection, production route wiring and HTTP responses stay real.
function runRoutes(
  url: string,
  headers: Record<string, string>[] = [{}, {}, {}, {}, {}],
  env: Record<string, string | undefined> = {},
  parallel = false,
) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      '--no-env-file',
      '-e',
      `
    import { mock } from 'bun:test';
    import { NextRequest } from 'next/server';
    let work = 0;
    mock.module('./src/server/db', () => ({ sql: async () => { work++; return []; } }));
    globalThis.fetch = async () => { work++; return Response.json({ results: [] }); };
    const podcasts = await import('./src/app/api/search/route');
    const episodes = await import('./src/app/api/search/episodes/route');
    const headers = ${JSON.stringify(headers)};
    async function invoke(i) {
      const post = i % 3 === 1;
      const request = new NextRequest('https://origin-' + (i % 2) + '.invalid/api/search?term=history', {
        method: post ? 'POST' : 'GET', headers: headers[i],
        ...(post ? { body: JSON.stringify({ term: 'history' }) } : {}),
      });
      try {
        const response = await (post ? podcasts.POST : i % 3 === 2 ? episodes.GET : podcasts.GET)(request);
        return { status: response.status, cache: response.headers.get('cache-control'), retry: response.headers.get('retry-after'), body: await response.json() };
      } catch { return { status: 599 }; }
    }
    const responses = [];
    if (${parallel}) responses.push(...await Promise.all(headers.map((_, i) => invoke(i))));
    else for (let i = 0; i < headers.length; i++) responses.push(await invoke(i));
    console.log(JSON.stringify({ responses, work }));
    process.exit(0);
  `,
    ],
    {
      env: {
        PATH: process.env.PATH,
        REDIS_URL: url,
        AUTH_CODE_SECRET: 'ab'.repeat(32),
        SEARCH_SOURCE_PER_MINUTE: '3',
        SEARCH_GLOBAL_PER_MINUTE: '5',
        ...env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10_000,
    },
  );
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({
    code: 0,
    stderr: '',
  });
  return JSON.parse(result.stdout.toString()) as {
    responses: {
      status: number;
      cache: string | null;
      retry: string | null;
      body: unknown;
    }[];
    work: number;
  };
}

describe.skipIf(!executable)(
  'production search routes with disposable Redis',
  () => {
    let server: ReturnType<typeof Bun.spawn>;
    let redis: Redis;
    let url: string;
    beforeAll(async () => {
      if (!executable) throw new Error('redis-server required');
      const listener = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data() {} },
      });
      const port = listener.port;
      listener.stop(true);
      url = `redis://127.0.0.1:${port}`;
      server = Bun.spawn(
        [
          executable,
          '--bind',
          '127.0.0.1',
          '--port',
          String(port),
          '--save',
          '',
          '--appendonly',
          'no',
        ],
        { stdout: 'ignore', stderr: 'pipe' },
      );
      redis = new Redis(url, {
        retryStrategy: () => 50,
        maxRetriesPerRequest: 100,
      });
      redis.on('error', () => {});
      await redis.ping();
    }, 10_000);
    beforeEach(async () => {
      await redis.flushdb();
    });
    afterAll(async () => {
      redis?.disconnect();
      server?.kill();
      await server?.exited;
    });

    test('GET, POST and episode search share budget across processes and forged client headers', () => {
      const headers = Array.from({ length: 5 }, (_, i) => ({
        'x-forwarded-for': `192.0.2.${i + 1}`,
        'x-real-ip': `192.0.2.${i + 1}`,
        'x-podcst-client': i % 2 ? 'native' : 'browser',
      }));
      const first = runRoutes(url, headers);
      expect(first.responses.map((r) => r.status)).toEqual([
        200, 200, 200, 429, 429,
      ]);
      expect(first.work).toBe(3);
      const next = runRoutes(url, headers.slice(0, 3));
      expect(next.responses.map((r) => r.status)).toEqual([429, 429, 429]);
      expect(next.work).toBe(0);
      for (const response of next.responses) {
        expect(response.cache).toBe('private, no-store');
        expect(Number(response.retry)).toBeGreaterThan(0);
        expect(response.body).toEqual({
          code: 'rate_limited',
          message: 'Too many search requests',
        });
      }
    });

    test('only the configured trusted source separates callers; all still share the global ceiling', () => {
      const headers = Array.from({ length: 6 }, (_, i) => ({
        'test-ingress-ip': `192.0.2.${i + 1}`,
      }));
      const result = runRoutes(url, headers, {
        AUTH_TRUSTED_IP_HEADER: 'test-ingress-ip',
      });
      expect(result.responses.map((r) => r.status)).toEqual([
        200, 200, 200, 200, 200, 429,
      ]);
      expect(result.work).toBe(5);
    });

    test('concurrent routes on a cold connection cannot exceed the source budget', () => {
      const result = runRoutes(
        url,
        Array.from({ length: 12 }, () => ({})),
        {},
        true,
      );
      expect(result.responses.filter((r) => r.status === 200)).toHaveLength(3);
      expect(result.responses.filter((r) => r.status === 429)).toHaveLength(9);
      expect(result.work).toBe(3);
    });

    test('missing or invalid policy fails closed before search work', () => {
      for (const env of [
        { SEARCH_SOURCE_PER_MINUTE: undefined },
        { SEARCH_GLOBAL_PER_MINUTE: '0' },
        { AUTH_CODE_SECRET: undefined },
      ]) {
        const result = runRoutes(url, [{}, {}, {}], env);
        expect(result.responses.map((r) => r.status)).toEqual([503, 503, 503]);
        expect(result.work).toBe(0);
      }
    });

    test('Redis outage returns bounded private refusals before external work', () => {
      const listener = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data() {} },
      });
      const closedPort = listener.port;
      listener.stop(true);
      const result = runRoutes(`redis://127.0.0.1:${closedPort}`, [{}, {}, {}]);
      expect(result.work).toBe(0);
      for (const response of result.responses) {
        expect(response.status).toBe(503);
        expect(response.cache).toBe('private, no-store');
        expect(response.retry).toBe('5');
        expect(response.body).toEqual({
          code: 'unavailable',
          message: 'Search unavailable',
        });
      }
    });

    test('a Redis connection that never answers cannot hang or admit search', () => {
      const listener = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: { data() {} },
      });
      try {
        const started = performance.now();
        const result = runRoutes(`redis://127.0.0.1:${listener.port}`, [{}]);
        expect(performance.now() - started).toBeLessThan(3000);
        expect(result.responses.map((r) => r.status)).toEqual([503]);
        expect(result.work).toBe(0);
      } finally {
        listener.stop(true);
      }
    });
  },
);
