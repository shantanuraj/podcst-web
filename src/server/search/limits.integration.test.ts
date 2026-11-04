import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Redis } from 'ioredis';
import { createSearchLimiter } from './limits';

const executable = Bun.which('redis-server');
if (process.env.REQUIRE_LIST_LIMIT_TESTS === '1' && !executable)
  throw new Error('redis-server required for search budget integration tests');

describe.skipIf(!executable)('search budgets on disposable Redis', () => {
  let server: ReturnType<typeof Bun.spawn>;
  let first: Redis;
  let second: Redis;
  const secret = 'synthetic-search-budget-secret-32-bytes';
  const policy = { sourcePerMinute: 3, globalPerMinute: 5 };

  beforeAll(async () => {
    if (!executable) throw new Error('redis-server required');
    const listener = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {} },
    });
    const port = listener.port;
    listener.stop(true);
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
    first = new Redis({
      host: '127.0.0.1',
      port,
      retryStrategy: () => 50,
      maxRetriesPerRequest: 100,
    });
    first.on('error', () => {});
    await first.ping();
    second = new Redis({
      host: '127.0.0.1',
      port,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    second.on('error', () => {});
    await new Promise<void>((resolve) => second.once('ready', resolve));
  }, 10_000);

  beforeEach(async () => {
    await first.flushdb();
  });
  afterAll(async () => {
    first?.disconnect();
    second?.disconnect();
    server?.kill();
    await server?.exited;
  });

  test('two clients share one atomic source budget without charging denied requests', async () => {
    const limits = [first, second].map((redis) =>
      createSearchLimiter(redis, secret, policy),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => limits[i % 2]('192.0.2.1')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason.status).toBe(429);
        expect(result.reason.retryAfter).toBeGreaterThan(0);
        expect(result.reason.retryAfter).toBeLessThanOrEqual(60);
      }
    }
    // Source refusals must not spend the two remaining global permits.
    await limits[1]('192.0.2.2');
    await limits[0]('192.0.2.2');
    await expect(limits[1]('192.0.2.3')).rejects.toMatchObject({ status: 429 });
    for (const key of await first.keys('search:*')) {
      expect(key).not.toContain('192.0.2');
      expect(await first.pttl(key)).toBeGreaterThan(0);
      expect(await first.pttl(key)).toBeLessThanOrEqual(60_000);
    }
  });

  test('changing source or application instance cannot bypass the global ceiling', async () => {
    const limits = [first, second].map((redis) =>
      createSearchLimiter(redis, secret, policy),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => limits[i % 2](`192.0.2.${i + 1}`)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(15);
  });

  test('rolling windows recover using Redis time without stale usage', async () => {
    const limit = createSearchLimiter(first, secret, policy);
    await limit('192.0.2.1');
    await limit('192.0.2.1');
    await limit('192.0.2.1');
    await expect(limit('192.0.2.1')).rejects.toMatchObject({ status: 429 });
    // Age real reservations; no minute-long wall-clock sleep or alternate limiter.
    for (const key of await first.keys('search:*')) {
      for (const member of await first.zrange(key, 0, -1))
        await first.zadd(key, 0, member);
    }
    await expect(limit('192.0.2.1')).resolves.toBeUndefined();
  });

  test('a disconnected client fails closed instead of using local counters', async () => {
    const disconnected = second.duplicate({ lazyConnect: true });
    disconnected.disconnect();
    await expect(
      createSearchLimiter(disconnected, secret, policy)('192.0.2.1'),
    ).rejects.toMatchObject({ status: 503 });
    expect(await first.keys('search:*')).toEqual([]);
  });

  test('a restricted app identity needs the exact search namespace and retains other denials', async () => {
    const username = 'synthetic_search_app';
    const password = 'synthetic-local-only-password';
    // Mirror the existing app command/prefix allowlist before search was added.
    await first.acl(
      'SETUSER',
      username,
      'reset',
      'on',
      `>${password}`,
      '~auth:*',
      '~lists:*',
      '~chapters:*',
      '~top@2/*',
      '~feed-*',
      '~short-*',
      '+ping',
      '+quit',
      '+info',
      '+client|setname',
      '+get',
      '+getrange',
      '+getdel',
      '+set',
      '+del',
      '+incr',
      '+expire',
      '+pexpire',
      '+zremrangebyscore',
      '+zcard',
      '+zrange',
      '+zadd',
      '+time',
      '+eval',
    );
    const app = first.duplicate({
      username,
      password,
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    app.on('error', () => {});
    try {
      await app.connect();
      expect(app.status).toBe('ready');
      const limit = createSearchLimiter(app, secret, policy);
      await expect(limit('192.0.2.1')).rejects.toMatchObject({
        status: 503,
        message: 'Search unavailable',
      });
      expect(await first.keys('search:*')).toEqual([]);

      await first.acl('SETUSER', username, '~search:{budget}:*');
      for (let i = 0; i < policy.sourcePerMinute; i++)
        await expect(limit('192.0.2.1')).resolves.toBeUndefined();
      await expect(limit('192.0.2.1')).rejects.toMatchObject({ status: 429 });
      expect(await first.zcard('search:{budget}:global')).toBe(3);
      await expect(app.get('search:outside-budget')).rejects.toThrow('NOPERM');
      await expect(app.get('unrelated:synthetic')).rejects.toThrow('NOPERM');
    } finally {
      app.disconnect();
      await first.acl('DELUSER', username);
    }
  });
});
