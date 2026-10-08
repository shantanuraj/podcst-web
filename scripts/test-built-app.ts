import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Redis } from 'ioredis';
import { startPostgres } from './lib/postgres-sandbox';
import { createSchemaFixture } from './lib/schema-fixture';

const root = resolve(import.meta.dir, '..');
const build = process.env.BUILT_APP_DIRECTORY;
if (!build || !process.env.PG_BIN)
  throw new Error('BUILT_APP_DIRECTORY and PG_BIN are required');
const candidate = resolve(build);
const standalone = join(candidate, '.next/standalone');
if (!existsSync(join(standalone, 'server.js')))
  throw new Error('Build the standalone candidate first');
for (const file of [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
])
  if (existsSync(join(standalone, file)))
    throw new Error('Use a standalone candidate without environment files');

const temporary = mkdtempSync(join(tmpdir(), 'podcst-built-smoke-'));
chmodSync(temporary, 0o700);
const environment = {
  PATH: process.env.PATH,
  HOME: temporary,
  TMPDIR: process.env.TMPDIR,
};
const abort = new AbortController();
let cluster: ReturnType<typeof startPostgres> | undefined;
let redis: ReturnType<typeof Bun.spawn> | undefined;
let probe: Redis | undefined;
let app: ReturnType<typeof Bun.spawn> | undefined;
let tests: ReturnType<typeof Bun.spawn> | undefined;
let status = 1;
let interrupted: number | undefined;
const interrupt = (code: number) => {
  interrupted ??= code;
  abort.abort(new Error('Built-app checks interrupted'));
  if (tests?.exitCode === null) tests.kill();
};
const sigint = () => interrupt(130);
const sigterm = () => interrupt(143);
process.on('SIGINT', sigint);
process.on('SIGTERM', sigterm);

async function stop(child: ReturnType<typeof Bun.spawn> | undefined) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await child.exited;
  } finally {
    clearTimeout(timer);
  }
}

async function ready(
  check: () => Promise<boolean>,
  child: ReturnType<typeof Bun.spawn>,
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    abort.signal.throwIfAborted();
    if (child.exitCode !== null)
      throw new Error('A sandbox process exited before readiness');
    try {
      if (await check()) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('A sandbox process failed readiness');
}

try {
  cluster = startPostgres({ tcp: true });
  const socket = join(temporary, 'redis.sock');
  redis = Bun.spawn(
    [
      'redis-server',
      '--port',
      '0',
      '--unixsocket',
      socket,
      '--unixsocketperm',
      '700',
      '--save',
      '',
      '--appendonly',
      'no',
      '--dir',
      temporary,
    ],
    {
      env: environment,
      stdout: Bun.file(join(temporary, 'redis.log')),
      stderr: Bun.file(join(temporary, 'redis-errors.log')),
    },
  );
  probe = new Redis({
    path: socket,
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  const client = probe;
  await ready(async () => {
    if (client.status === 'wait' || client.status === 'end')
      await client.connect();
    return (await client.ping()) === 'PONG';
  }, redis);
  probe.disconnect();
  await createSchemaFixture(cluster.sql);
  await cluster.sql.unsafe(
    readFileSync(join(root, 'scripts/fixtures/web-smoke.sql'), 'utf8'),
  );
  abort.signal.throwIfAborted();
  if (!existsSync(join(standalone, 'public')))
    symlinkSync(join(candidate, 'public'), join(standalone, 'public'));
  if (!existsSync(join(standalone, '.next/static')))
    symlinkSync(
      join(candidate, '.next/static'),
      join(standalone, '.next/static'),
    );
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data() {} },
  });
  const appPort = listener.port;
  listener.stop(true);
  const base = `http://127.0.0.1:${appPort}`;
  app = Bun.spawn(['node', join(standalone, 'server.js')], {
    cwd: standalone,
    env: {
      ...environment,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(appPort),
      APP_URL: base,
      DATABASE_URL: cluster.url,
      REDIS_URL: socket,
      AUTH_CODE_SECRET: 'a'.repeat(64),
      WEBAUTHN_ORIGIN: base,
      WEBAUTHN_RP_ID: 'localhost',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdout: Bun.file(join(temporary, 'app.log')),
    stderr: Bun.file(join(temporary, 'app-errors.log')),
  });
  await ready(async () => {
    const response = await fetch(`${base}/api/health`, {
      redirect: 'error',
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]),
    });
    await response.body?.cancel();
    return response.ok;
  }, app);
  abort.signal.throwIfAborted();
  tests = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      'test',
      'src/app/ssr.integration.test.ts',
      'scripts/state-api.integration.test.ts',
    ],
    {
      cwd: root,
      env: {
        ...environment,
        SSR_TEST_BASE_URL: base,
        STATE_TEST_BASE_URL: base,
        STATE_TEST_SOCKET: cluster.directory,
        STATE_TEST_PORT: String(cluster.options.port),
      },
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  status = await tests.exited;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Built-app checks failed',
  );
} finally {
  probe?.disconnect();
  const stopped = await Promise.allSettled([
    stop(tests),
    stop(app),
    stop(redis),
  ]);
  if (stopped.some((result) => result.status === 'rejected')) status = 1;
  try {
    await cluster?.stop();
  } catch (error) {
    status = 1;
    console.error(
      error instanceof Error ? error.message : 'Sandbox cleanup failed',
    );
  }
  process.off('SIGINT', sigint);
  process.off('SIGTERM', sigterm);
  status = interrupted ?? status;
  if (status === 0) rmSync(temporary, { recursive: true, force: true });
  else console.error(`Built-app logs retained at ${temporary}`);
}
process.exitCode = status;
