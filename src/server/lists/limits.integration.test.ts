import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Redis } from 'ioredis';
import { createListLimiter } from './limits';

const executable = Bun.which('redis-server');
if (process.env.REQUIRE_LIST_LIMIT_TESTS === '1' && !executable) {
  throw new Error('redis-server required for list limiter integration tests');
}

describe.skipIf(!executable)('list limits on disposable Redis', () => {
  let server: ReturnType<typeof Bun.spawn>;
  let redis: Redis;

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
    redis = new Redis({
      host: '127.0.0.1',
      port,
      retryStrategy: () => 50,
      maxRetriesPerRequest: 100,
      connectTimeout: 1000,
    });
    redis.on('error', () => {});
    await redis.ping();
  }, 10_000);

  afterAll(async () => {
    redis?.disconnect();
    server?.kill();
    await server?.exited;
  });

  test('atomically bounds concurrent mutations and stream registrations', async () => {
    const limit = createListLimiter(redis);
    const mutations = await Promise.allSettled(
      Array.from({ length: 121 }, () => limit('owner', 'changes')),
    );
    expect(
      mutations.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(120);
    expect(
      mutations.filter(({ status }) => status === 'rejected'),
    ).toHaveLength(1);
    const clients = await Promise.allSettled(
      Array.from({ length: 21 }, () => limit('owner', 'clients')),
    );
    expect(clients.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      20,
    );
    expect(clients.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    await expect(limit('other', 'changes')).resolves.toBeUndefined();
    for (const key of await redis.keys('lists:limit:*')) {
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      expect(key).not.toContain('owner');
    }
  });
});
