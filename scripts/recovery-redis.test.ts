import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Redis } from 'ioredis';
import {
  assertAuthEpoch,
  authEpochKey,
  redisIdentity,
} from '../src/server/erasure/recovery-auth';
import {
  createRecoveryRedis,
  type RecoveryRedisConfiguration,
} from './lib/recovery-redis';
import { startRedis } from './lib/redis-sandbox';
import { createTLSFixture } from './lib/tls-fixture';

const required = !!Bun.which('openssl') && !!Bun.which('redis-server');
if (process.env.REQUIRE_ERASURE_TESTS === '1' && !required)
  throw new Error(
    'openssl and redis-server required for recovery transport tests',
  );

describe.skipIf(!required)('protected recovery Redis transport', () => {
  let directory: string;
  let cache: Awaited<ReturnType<typeof startRedis>>;
  let config: RecoveryRedisConfiguration;
  const clients: Redis[] = [];
  const connect = (value = config) => {
    const client = createRecoveryRedis(value);
    clients.push(client);
    return client;
  };
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'podcst-recovery-tls-'));
    const tls = createTLSFixture(directory);
    cache = await startRedis({ tls });
    const password = randomUUID();
    await cache.redis.acl(
      'SETUSER',
      'recovery',
      'on',
      `>${password}`,
      '~auth:epoch:*',
      '~auth:flow:*',
      '+get',
      '+set',
      '+scan',
      '+info',
      '+ping',
      '+client|setinfo',
    );
    const url = new URL(cache.url);
    url.username = 'recovery';
    url.password = password;
    config = {
      url: url.toString(),
      tls: {
        ca: readFileSync(tls.ca, 'utf8'),
        cert: readFileSync(tls.client.cert, 'utf8'),
        key: readFileSync(tls.client.key, 'utf8'),
      },
    };
  }, 15_000);
  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await cache?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test('verified mutual TLS supports the controller under constrained Redis ACLs', async () => {
    const redis = connect();
    const epoch = randomUUID();
    const run = randomUUID();
    const key = authEpochKey(epoch);
    expect(await redis.set(key, run, 'NX')).toBe('OK');
    const identity = await redisIdentity(redis);
    await assertAuthEpoch(redis, epoch, run, identity);
    expect(identity).toMatch(/^[a-f0-9]{40}$/);
    const [, keys] = await redis.scan(
      '0',
      'MATCH',
      `auth:flow:${epoch}:*`,
      'COUNT',
      100,
    );
    expect(keys).toHaveLength(0);
    await expect(redis.get('private:outside-controller')).rejects.toThrow(
      'NOPERM',
    );
    await expect(redis.flushall()).rejects.toThrow('NOPERM');
  });

  test('missing client identity, wrong CA and bad Redis credentials fail closed', async () => {
    const foreign = join(directory, 'foreign');
    mkdirSync(foreign, { mode: 0o700 });
    const untrusted = createTLSFixture(foreign);
    const password = new URL(config.url);
    password.password = randomUUID();
    for (const value of [
      { url: config.url, tls: { ca: config.tls?.ca } },
      {
        url: config.url,
        tls: { ...config.tls, ca: readFileSync(untrusted.ca, 'utf8') },
      },
      { ...config, url: password.toString() },
    ])
      await expect(connect(value).ping()).rejects.toThrow();
  }, 15_000);

  test('a trusted server certificate for the wrong hostname is refused', async () => {
    const path = join(directory, 'hostname');
    mkdirSync(path, { mode: 0o700 });
    const tls = createTLSFixture(path, 'IP:127.0.0.1');
    const server = await startRedis({ tls });
    try {
      const url = new URL(server.url);
      url.hostname = 'localhost';
      const client = connect({
        url: url.toString(),
        tls: {
          ca: readFileSync(tls.ca, 'utf8'),
          cert: readFileSync(tls.client.cert, 'utf8'),
          key: readFileSync(tls.client.key, 'utf8'),
        },
      });
      const failure = new Promise<Error>((resolve) =>
        client.once('error', resolve),
      );
      await expect(client.ping()).rejects.toThrow();
      expect(await failure).toMatchObject({
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      });
    } finally {
      await server.close();
    }
  }, 15_000);

  test('refuse plaintext remote endpoints and URL/TLS overrides before connecting', () => {
    for (const value of [
      { url: 'redis://cache.example.invalid:6379' },
      { url: 'redis://127.0.0.1:6379', tls: config.tls },
      { ...config, url: `${config.url}?tls=anything` },
      { ...config, url: `${config.url}#ignored` },
      { ...config, tls: { ca: config.tls?.ca, cert: config.tls?.cert } },
      { ...config, tls: { ...config.tls, rejectUnauthorized: false } },
    ])
      expect(() => createRecoveryRedis(value)).toThrow();
  });

  test('server identity permission loss fails authentication retirement', async () => {
    const redis = connect();
    await redis.ping();
    await cache.redis.acl('SETUSER', 'recovery', '-info');
    try {
      await expect(redisIdentity(redis)).rejects.toThrow('NOPERM');
    } finally {
      await cache.redis.acl('SETUSER', 'recovery', '+info');
    }
  });
});
