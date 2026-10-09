import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Redis } from 'ioredis';
import { createFeedAdmission } from './feed-admission';

const executable = Bun.which('redis-server');
if (process.env.REQUIRE_LIST_LIMIT_TESTS === '1' && !executable)
  throw new Error('redis-server required for feed admission integration tests');

describe.skipIf(!executable)(
  'shared feed admission on disposable Redis',
  () => {
    let server: ReturnType<typeof Bun.spawn>;
    let redis: Redis;
    let admission: ReturnType<typeof createFeedAdmission>;
    const owner = { kind: 'account' as const, id: 'private-account' };
    const secret = 'synthetic-secret-for-feed-admission-tests';

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
      admission = createFeedAdmission(redis, secret);
    }, 10_000);
    afterAll(async () => {
      redis?.disconnect();
      server?.kill();
      await server?.exited;
    });
    beforeEach(async () => {
      await redis.flushdb();
    });

    test('parallel requests cannot exceed per-principal refresh and batch budgets', async () => {
      const otherProcess = createFeedAdmission(redis, secret);
      const refreshes = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          (i % 2 ? otherProcess : admission).refresh(owner),
        ),
      );
      expect(
        refreshes.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(12);
      for (const response of refreshes)
        if (response.status === 'rejected') {
          expect(response.reason.code).toBe('rate_limited');
          expect(response.reason.retryAfterSeconds).toBeGreaterThan(0);
        }
      const batches = await Promise.allSettled(
        Array.from({ length: 10 }, () => admission.importRequest(owner)),
      );
      expect(
        batches.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(6);
      for (const key of await redis.keys('feeds:*')) {
        expect(key).not.toContain(owner.id);
        expect(await redis.pttl(key)).toBeGreaterThan(0);
      }
    });

    test('global refresh budget prevents amplification across accounts and anonymous sources', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 75 }, (_, i) =>
          admission.refresh({
            kind: i % 2 ? 'source' : 'account',
            id: String(i),
          }),
        ),
      );
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(60);
    });

    test('import concurrency is atomic across processes and principals', async () => {
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () => admission.importLease(owner)),
      );
      const accepted = attempts.flatMap((value) =>
        value.status === 'fulfilled' ? [value.value] : [],
      );
      expect(accepted).toHaveLength(2);
      await Promise.all(accepted.map((lease) => lease.release()));
      const global = await Promise.allSettled(
        Array.from({ length: 30 }, (_, i) =>
          admission.importLease({ kind: 'account', id: `account-${i}` }),
        ),
      );
      const running = global.flatMap((value) =>
        value.status === 'fulfilled' ? [value.value] : [],
      );
      expect(running).toHaveLength(16);
      await Promise.all(running.map((lease) => lease.release()));
    });

    test('expiry fences stale holders and late release cannot remove replacements', async () => {
      const old = await admission.importLease(owner);
      const keys = await redis.keys('feeds:*:import-active:*');
      for (const key of keys) {
        for (const token of await redis.zrange(key, 0, -1))
          await redis.zadd(key, 0, token);
      }
      await expect(old.assertOwned()).rejects.toMatchObject({
        code: 'unavailable',
      });
      const replacement = await admission.importLease(owner);
      await old.release();
      await expect(replacement.assertOwned()).resolves.toBeUndefined();
      await replacement.release();
      await expect(replacement.assertOwned()).rejects.toMatchObject({
        code: 'unavailable',
      });
    });

    test('cancellation prevents further publication checks without consuming another permit', async () => {
      const controller = new AbortController();
      const lease = await admission.importLease(owner, controller.signal);
      controller.abort();
      await expect(lease.assertOwned()).rejects.toThrow();
      await lease.release();
      await expect(
        admission.importLease(owner, controller.signal),
      ).rejects.toThrow();
      for (const key of await redis.keys('feeds:*:import-active:*'))
        expect(await redis.zcard(key)).toBe(0);
    });

    test('global starts remain bounded even when work completes immediately', async () => {
      for (let i = 0; i < 120; i++) {
        const lease = await admission.importLease({
          kind: 'source',
          id: `source-${i}`,
        });
        await lease.release();
      }
      await expect(admission.importLease(owner)).rejects.toMatchObject({
        code: 'rate_limited',
      });
    });
  },
);

test('feed admission fails closed on unavailable or malformed shared state', async () => {
  for (const result of [null, '0', -1, 0.5]) {
    const fake = { eval: async () => result } as unknown as Pick<Redis, 'eval'>;
    await expect(
      createFeedAdmission(
        fake,
        'synthetic-secret-of-sufficient-length',
      ).refresh({ kind: 'source', id: 'unattributed' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  }
  const fake = {
    eval: async () => {
      throw new Error('Disconnected');
    },
  } as unknown as Pick<Redis, 'eval'>;
  await expect(
    createFeedAdmission(
      fake,
      'synthetic-secret-of-sufficient-length',
    ).importLease({ kind: 'account', id: 'owner' }),
  ).rejects.toMatchObject({ code: 'unavailable' });
});
