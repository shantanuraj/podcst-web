import { expect, test } from 'bun:test';
import { startPostgres } from '../../scripts/lib/postgres-sandbox';

function evaluate(
  source: string,
  env: Record<string, string | undefined> = {},
) {
  const result = Bun.spawnSync(
    [process.execPath, '--no-env-file', '-e', source],
    {
      env: { PATH: process.env.PATH, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10_000,
    },
  );
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({
    code: 0,
    stderr: '',
  });
  return JSON.parse(result.stdout.toString());
}

function redisOptions(env: Record<string, string | undefined>, options = {}) {
  return evaluate(
    `import { createRedis } from './src/server/redis';
     const redis = createRedis(${JSON.stringify(options)});
     console.log(JSON.stringify({ ...redis.options, status: redis.status }));
     redis.disconnect();`,
    env,
  );
}

test('database and cache modules import without credentials or connections', () => {
  expect(
    evaluate(`
      import { Socket } from 'node:net';
      let connections = 0;
      Socket.prototype.connect = function () {
        connections++;
        throw new Error('Unexpected network access');
      };
      await import('./src/server/db');
      await import('./src/app/api/redis');
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log(JSON.stringify(connections));
      process.exit(0);
    `),
  ).toBe(0);
});

test('database configuration is still required on first use', () => {
  expect(
    evaluate(`
      import { sql } from './src/server/db';
      try { sql\`SELECT 1\`; } catch (error) {
        console.log(JSON.stringify(error.message));
      }
    `),
  ).toBe('DATABASE_URL or PG_HOST environment variable is required');
});

test('Redis remains disconnected until a command and bounds request waits', () => {
  expect(redisOptions({})).toMatchObject({
    status: 'wait',
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
  });
});

test.each([
  { REDIS_URL: 'redis://cache.example.invalid:6381/4' },
  { KV_REDIS_URL: 'redis://cache.example.invalid:6381/4' },
  {
    REDIS_URL: 'redis://cache.example.invalid:6381/4',
    KV_REDIS_HOST: 'unused.example.invalid',
    KV_REDIS_URL: 'redis://unused.example.invalid:6382',
  },
  {
    VERCEL: '1',
    KV_REDIS_URL: 'redis://cache.example.invalid:6381/4',
    REDIS_URL: 'redis://unused.example.invalid:6382',
  },
])('uses the appropriate Redis URL without a Vercel-only restriction: %j', (env) => {
  expect(redisOptions(env)).toMatchObject({
    host: 'cache.example.invalid',
    port: 6381,
    db: 4,
  });
});

test.each([
  {
    REDIS_HOST: 'cache.example.invalid',
    REDIS_PORT: '6381',
    REDIS_PASSWORD: 'test-only',
  },
  {
    KV_REDIS_HOST: 'cache.example.invalid',
    KV_REDIS_PORT: '6381',
    KV_REDIS_PASS: 'test-only',
  },
  {
    VERCEL: 'true',
    KV_REDIS_HOST: 'cache.example.invalid',
    KV_REDIS_PORT: '6381',
    KV_REDIS_PASS: 'test-only',
    REDIS_HOST: 'unused.example.invalid',
  },
])('supports host-based Redis configuration: %j', (env) => {
  expect(redisOptions(env)).toMatchObject({
    host: 'cache.example.invalid',
    port: 6381,
    password: 'test-only',
  });
});

test('preserves TLS and explicit connection policies', () => {
  expect(
    redisOptions(
      {
        REDIS_URL: 'rediss://cache.example.invalid:6381',
        MTLS_CA: 'test-ca\\nsecond-line',
        MTLS_CERT: 'test-cert',
        MTLS_KEY: 'test-key',
      },
      { commandTimeout: 500, maxRetriesPerRequest: 0 },
    ),
  ).toMatchObject({
    tls: {
      ca: 'test-ca\nsecond-line',
      cert: 'test-cert',
      key: 'test-key',
      rejectUnauthorized: true,
    },
    commandTimeout: 500,
    maxRetriesPerRequest: 0,
  });
});

test.skipIf(!process.env.PG_BIN)(
  'lazy SQL preserves tagged queries, transactions and methods',
  async () => {
    const cluster = startPostgres({ tcp: true });
    try {
      expect(
        evaluate(
          `
      import { sql } from './src/server/db';
      const [tagged] = await sql\`SELECT 41 + \${1} AS value\`;
      const [transaction] = await sql.begin(tx => tx\`SELECT 7 AS value\`);
      const [unsafe] = await sql.unsafe('SELECT 9 AS value');
      const [identity] = await sql\`SELECT 9007199254740993::bigint AS id,
        9223372036854775807::bigint AS maximum,
        ARRAY[9007199254740993,9223372036854775807]::bigint[] AS ids\`;
      await sql.end({ timeout: 1 });
      console.log(JSON.stringify([tagged.value, transaction.value, unsafe.value, identity]));
    `,
          { DATABASE_URL: cluster.url },
        ),
      ).toEqual([
        42,
        7,
        9,
        {
          id: '9007199254740993',
          maximum: '9223372036854775807',
          ids: ['9007199254740993', '9223372036854775807'],
        },
      ]);
    } finally {
      await cluster.stop();
    }
  },
);
