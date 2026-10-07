import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Redis } from 'ioredis';
import { createAuthLimiter, trustedAuthSource } from './limits';

const executable = Bun.which('redis-server');
const secret = 'synthetic-limit-key'.repeat(4);

describe('trusted authentication source', () => {
  test('ignores forwarded headers unless explicitly configured', () => {
    const request = new Request('https://example.invalid', {
      headers: {
        'x-forwarded-for': '192.0.2.1',
        'x-verified-ip': '2001:db8:0:0::1',
      },
    });
    expect(trustedAuthSource(request)).toBe('unattributed');
    expect(trustedAuthSource(request, 'x-verified-ip')).toBe('[2001:db8::1]');
    expect(
      trustedAuthSource(
        new Request(request, {
          headers: {
            'x-verified-ip': '192.0.2.1, 192.0.2.2',
          },
        }),
        'x-verified-ip',
      ),
    ).toBe('unattributed');
  });

  test('Redis failures and invalid results fail closed', async () => {
    for (const evalFn of [
      async () => {
        throw new Error('private');
      },
      async () => null,
    ]) {
      const limit = createAuthLimiter(
        { eval: evalFn } as unknown as Redis,
        secret,
      );
      await expect(
        limit('send', 'synthetic@example.invalid', 'source'),
      ).rejects.toMatchObject({
        status: 503,
        message: 'Authentication unavailable',
      });
    }
  });
});

describe.skipIf(!executable)('auth limits on disposable Redis', () => {
  let server: ReturnType<typeof Bun.spawn>;
  let redis: Redis;
  let limit: ReturnType<typeof createAuthLimiter>;

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
    });
    redis.on('error', () => {});
    await redis.ping();
    limit = createAuthLimiter(redis, secret);
  }, 10_000);

  afterAll(async () => {
    redis?.disconnect();
    server?.kill();
    await server?.exited;
  });

  test('concurrent sends allow one issuance and report cooldown without spending hourly quota', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        limit('send', 'cooldown@example.invalid', 'cooldown'),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const denied = results.filter((result) => result.status === 'rejected');
    expect(denied).toHaveLength(9);
    for (const result of denied) {
      expect(result.reason.status).toBe(429);
      expect(result.reason.retryAfter).toBeGreaterThan(0);
      expect(result.reason.retryAfter).toBeLessThanOrEqual(60);
    }
    await expect(
      limit('send', 'COOLDOWN@example.invalid', 'another-source'),
    ).rejects.toMatchObject({ status: 429 });
    for (const key of await redis.keys('auth:limit:*')) {
      expect(await redis.zcard(key)).toBe(1);
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      expect(key).not.toContain('example');
    }
  });

  test('five sends per email in a rolling hour', async () => {
    for (let i = 0; i < 5; i++) {
      await redis.del(...(await redis.keys('auth:limit:cooldown:*')));
      await limit('send', 'hour@example.invalid', 'hour');
    }
    await redis.del(...(await redis.keys('auth:limit:cooldown:*')));
    await expect(
      limit('send', 'hour@example.invalid', 'hour'),
    ).rejects.toMatchObject({ status: 429 });
  });

  test('bounds concurrent sends across subjects from one source', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        limit('send', `source-${i}@example.invalid`, 'shared-source'),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      20,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      10,
    );
  });

  test('bounds verification independently of issuance', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 26 }, () =>
        limit('verify', 'guesses@example.invalid', 'guesses'),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      25,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
  });
});
