import { expect, test } from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flyApplicationEnvironment } from './fly-recovery';
import { writeProtected } from './lib/artifacts';
import { createTLSFixture } from './lib/tls-fixture';

const configuration = () => ({
  port: 3000,
  upstream: 'http://127.0.0.1:3001',
  publicOrigin: 'https://example.invalid',
  journalId: randomUUID(),
  journal: 'https://evidence.example.invalid',
  token: randomBytes(32).toString('base64url'),
  epoch: randomUUID(),
  keys: { synthetic: 'public-key' },
  primary: {
    host: 'db.example.invalid',
    port: 5432,
    database: 'primary',
    role: 'fresh',
    password: 'synthetic-p@ss',
    tls: { ca: 'ca', cert: 'cert', key: 'key' },
  },
});

test('Fly derives the private app identity from the gateway configuration and strips conflicting overrides', () => {
  const config = configuration();
  const env = flyApplicationEnvironment(config, {
    DATABASE_URL: 'old',
    PG_HOST: '/unapproved',
    PGPASSWORD: 'old',
    PGSSLMODE: 'disable',
    RECOVERY_GATEWAY_CONFIG: 'operator configuration',
    RECOVERY_ADMISSION_REQUIRED: '0',
    ERASURE_JOURNAL_TOKEN: 'old',
    ACCOUNT_ERASURE_ENABLED: '1',
    HOSTNAME: '0.0.0.0',
    PORT: '3000',
    MTLS_KEY: 'old',
    KV_REDIS_URL: 'keep-cache',
    AUTH_CODE_SECRET: 'keep-auth',
  });
  expect(env).toMatchObject({
    HOSTNAME: '127.0.0.1',
    PORT: '3001',
    VERCEL: '0',
    RECOVERY_ADMISSION_REQUIRED: '1',
    ACCOUNT_ERASURE_ENABLED: '0',
    MTLS_CA: 'ca',
    MTLS_CERT: 'cert',
    MTLS_KEY: 'key',
    KV_REDIS_URL: 'keep-cache',
    AUTH_CODE_SECRET: 'keep-auth',
    ERASURE_JOURNAL_ID: config.journalId,
    ERASURE_JOURNAL_TOKEN: config.token,
    ERASURE_WRITER_EPOCH: config.epoch,
  });
  for (const name of [
    'PG_HOST',
    'PGPASSWORD',
    'PGSSLMODE',
    'RECOVERY_GATEWAY_CONFIG',
  ])
    expect(name in env).toBe(false);
  const database = new URL(env.DATABASE_URL);
  expect(database.username).toBe('fresh');
  expect(decodeURIComponent(database.password)).toBe(config.primary.password);
  expect(database.hostname).toBe(config.primary.host);
});

test('Fly refuses external or self-looping backends and non-mTLS primary configuration', () => {
  const config = configuration();
  for (const changed of [
    { ...config, upstream: 'http://127.0.0.1:3000' },
    { ...config, upstream: 'http://private.internal:3001' },
    { ...config, upstream: 'http://0.0.0.0:3001' },
    { ...config, journalId: 'wrong' },
    {
      ...config,
      primary: {
        socket: '/tmp',
        port: 5432,
        database: 'primary',
        role: 'fresh',
      },
    },
  ])
    expect(() => flyApplicationEnvironment(changed, {})).toThrow();
});

const required = !!Bun.which('node') && !!Bun.which('openssl');
if (process.env.REQUIRE_ERASURE_TESTS === '1' && !required)
  throw new Error('node and openssl required for Fly supervision tests');

test.skipIf(!required).each(['backend-exit', 'termination'])(
  'actual Fly supervision keeps Next private and closes both listeners on %s',
  async (stop) => {
    const directory = mkdtempSync(join(tmpdir(), 'podcst-fly-supervision-'));
    const reserve = () =>
      Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
    const publicPort = reserve();
    const privatePort = reserve();
    const config = configuration();
    const tls = createTLSFixture(directory);
    const pair = generateKeyPairSync('ed25519');
    const database = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        data(socket) {
          socket.end('N');
        },
      },
    });
    config.port = publicPort.port;
    config.upstream = `http://127.0.0.1:${privatePort.port}`;
    config.keys.synthetic = pair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    config.primary = {
      ...config.primary,
      host: '127.0.0.1',
      port: database.port,
      tls: {
        ca: readFileSync(tls.ca, 'utf8'),
        cert: readFileSync(tls.client.cert, 'utf8'),
        key: readFileSync(tls.client.key, 'utf8'),
      },
    };
    const path = join(directory, 'config.json');
    writeProtected(path, config);
    const backend = join(directory, 'server.mjs');
    writeFileSync(
      backend,
      `import http from 'node:http';
const server = http.createServer((request,response) => {
  response.setHeader('Connection','close');
  response.end(JSON.stringify({host:server.address().address,admission:process.env.RECOVERY_ADMISSION_REQUIRED,deletion:process.env.ACCOUNT_ERASURE_ENABLED,operatorConfig:process.env.RECOVERY_GATEWAY_CONFIG ?? null}));
  if (request.url === '/exit') server.close(() => process.exit(7));
});
server.listen(Number(process.env.PORT),process.env.HOSTNAME);`,
      { mode: 0o600 },
    );
    const runner = join(directory, 'run.ts');
    writeFileSync(
      runner,
      `import {runFlyRecovery} from ${JSON.stringify(new URL('./fly-recovery.ts', import.meta.url).pathname)};
try { await runFlyRecovery(process.argv[2],process.env,process.argv[3]); } catch { process.exitCode=1; }`,
      { mode: 0o600 },
    );
    publicPort.stop(true);
    privatePort.stop(true);
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', runner, path, backend],
      {
        env: {
          PATH: process.env.PATH,
          HOME: directory,
          RECOVERY_GATEWAY_CONFIG: 'must-not-reach-app',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    try {
      let ready: Response | undefined;
      for (let attempt = 0; attempt < 60; attempt++) {
        ready = await fetch(config.upstream, {
          signal: AbortSignal.timeout(500),
        }).catch(() => undefined);
        if (ready) break;
        await Bun.sleep(50);
      }
      expect(await ready?.json()).toEqual({
        host: '127.0.0.1',
        admission: '1',
        deletion: '0',
        operatorConfig: null,
      });
      expect(
        (
          await fetch(`http://127.0.0.1:${config.port}/api/private`, {
            signal: AbortSignal.timeout(3000),
          })
        ).status,
      ).toBe(503);
      if (stop === 'termination') child.kill('SIGTERM');
      else await fetch(`${config.upstream}/exit`);
      expect(await child.exited).toBe(stop === 'termination' ? 0 : 1);
      for (const url of [config.upstream, `http://127.0.0.1:${config.port}`])
        await expect(
          fetch(url, { signal: AbortSignal.timeout(1000) }),
        ).rejects.toThrow();
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
      await child.exited;
      database.stop(true);
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

test('the container entrypoint refuses missing protected configuration and exposes only the gateway', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      new URL('./fly-recovery.ts', import.meta.url).pathname,
    ],
    {
      env: { PATH: process.env.PATH },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toBe(
    'Fly recovery startup refused or upstream stopped\n',
  );
  const docker = readFileSync(
    new URL('../Dockerfile', import.meta.url),
    'utf8',
  );
  expect(docker).toContain(
    'CMD ["bun", "--no-env-file", "scripts/fly-recovery.js"]',
  );
  expect(docker.match(/^EXPOSE .+$/gm)).toEqual(['EXPOSE 3000']);
  expect(docker).not.toContain('HOSTNAME=0.0.0.0');
});
