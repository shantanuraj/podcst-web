import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import {
  ADMISSION_CHALLENGE,
  ADMISSION_RESPONSE,
  createAdmissionGateway,
  createAdmissionGuard,
} from '../src/server/erasure/admission';
import { createJournalHandler } from '../src/server/erasure/journal-http';
import {
  createPostgresJournal,
  initializeJournalStores,
} from '../src/server/erasure/journal-postgres';
import { createRecoveryController } from '../src/server/erasure/recovery';
import { createRecoveryControl } from '../src/server/erasure/recovery-control';
import { recoverySchema } from '../src/server/erasure/recovery-database';
import { startPostgres } from './lib/postgres-sandbox';
import { startRedis } from './lib/redis-sandbox';
import { migrate } from './migrations';
import { recoveryForwarder } from './recovery-gateway';

async function main() {
  if (
    !process.env.BUILT_APP_DIRECTORY ||
    !process.env.PG_BIN ||
    !Bun.which('openssl') ||
    !Bun.which('redis-server')
  )
    throw new Error(
      'BUILT_APP_DIRECTORY, PG_BIN, openssl and redis-server required',
    );
  const candidate = resolve(process.env.BUILT_APP_DIRECTORY);
  const standalone = join(candidate, '.next/standalone');
  for (const path of [
    '.env',
    '.env.local',
    '.env.production',
    '.env.production.local',
  ])
    assert(
      !existsSync(join(standalone, path)),
      'Standalone environment files refused',
    );
  assert(
    existsSync(join(standalone, 'server.js')),
    'Standalone build required',
  );
  const primary = startPostgres({ tcp: true });
  let independent: ReturnType<typeof startPostgres> | undefined;
  let cache: Awaited<ReturnType<typeof startRedis>> | undefined;
  let stores: postgres.Sql[] = [];
  let app: ReturnType<typeof Bun.spawn> | undefined;
  let evidence: ReturnType<typeof Bun.serve> | undefined;
  let gateway: ReturnType<typeof Bun.serve> | undefined;
  let runtime: postgres.Sql | undefined;
  let passed = 0;
  let failed = true;
  const check = (condition: unknown, message: string) => {
    assert(condition, message);
    passed++;
  };
  const port = () => {
    const listener = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {} },
    });
    const value = listener.port;
    listener.stop(true);
    return value;
  };
  try {
    const storage = startPostgres();
    independent = storage;
    cache = await startRedis();
    stores = Array.from({ length: 3 }, () =>
      postgres({ ...storage.options, max: 6 }),
    );
    await migrate(primary.sql);
    await primary.sql.unsafe(
      'CREATE ROLE gate_old NOLOGIN; CREATE ROLE gate_new NOLOGIN',
    );
    await primary.sql`GRANT USAGE ON SCHEMA public TO gate_new`;
    await primary.sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gate_new`;
    await primary.sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gate_new`;
    await primary.sql`GRANT EXECUTE ON FUNCTION pg_control_system() TO gate_new`;
    await primary.sql`REVOKE INSERT, UPDATE, DELETE ON recovery_state, state_generation FROM gate_new`;
    await primary.sql`INSERT INTO users (id,email) VALUES ('gate-user','gate@example.invalid')`;
    for (const name of ['journal', 'authority', 'receipts'])
      await stores[0].unsafe(
        readFileSync(
          new URL(`./erasure-journal/${name}.sql`, import.meta.url),
          'utf8',
        ),
      );
    const journalId = randomUUID();
    await initializeJournalStores(
      stores[0],
      stores[1],
      journalId,
      randomUUID(),
    );
    const pair = generateKeyPairSync('ed25519');
    const keys = {
      current: 'synthetic-built',
      signing: pair.privateKey,
      verification: new Map([['synthetic-built', pair.publicKey]]),
      encryption: new Map([['synthetic-built', randomBytes(32)]]),
    };
    const journal = createPostgresJournal(
      stores[0],
      stores[1],
      stores[2],
      journalId,
      keys,
    );
    const control = createRecoveryControl(stores[1], journal, keys);
    const controller = createRecoveryController({
      sql: primary.sql,
      journal,
      control,
      keys,
      redis: cache.redis,
      expected: await recoverySchema(primary.sql),
    });
    const permission = await controller.recover({
      id: randomUUID(),
      artifactHash: null,
      retiredRoles: ['gate_old'],
      servingRole: 'gate_new',
    });
    const token = await control.credential(permission.value.runId);
    await primary.sql`INSERT INTO sessions (id,user_id,expires_at) VALUES ('gate-session','gate-user',now()+interval '1 day')`;
    const cert = join(primary.directory, 'tls.crt');
    const key = join(primary.directory, 'tls.key');
    const certificate = Bun.spawnSync(
      [
        Bun.which('openssl') ?? '',
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    check(
      certificate.exitCode === 0,
      'Synthetic TLS certificate generation failed',
    );
    evidence = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      tls: { cert: Bun.file(cert), key: Bun.file(key) },
      fetch: createJournalHandler(
        journal,
        new Map([
          ['recovery', randomBytes(32).toString('base64url')],
          ['admission', randomBytes(32).toString('base64url')],
        ]),
        control,
      ),
    });
    const url = `https://127.0.0.1:${evidence.port}/`;
    const appPort = port();
    const gatewayPort = port();
    const publicOrigin = `http://127.0.0.1:${gatewayPort}`;
    const appUrl = `http://127.0.0.1:${appPort}`;
    for (const [path, target] of [
      [join(standalone, 'public'), join(candidate, 'public')],
      [join(standalone, '.next/static'), join(candidate, '.next/static')],
    ])
      if (!existsSync(path)) symlinkSync(target, path);
    const primaryUrl = new URL(primary.url);
    primaryUrl.username = 'gate_new';
    app = Bun.spawn(['node', join(standalone, 'server.js')], {
      cwd: standalone,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: primary.directory,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: String(appPort),
        APP_URL: publicOrigin,
        WEBAUTHN_ORIGIN: publicOrigin,
        WEBAUTHN_RP_ID: 'localhost',
        AUTH_CODE_SECRET: 'a'.repeat(64),
        DATABASE_URL: primaryUrl.toString(),
        REDIS_URL: cache.url,
        RECOVERY_ADMISSION_REQUIRED: '1',
        ERASURE_JOURNAL_URL: url,
        ERASURE_JOURNAL_TOKEN: token,
        ERASURE_WRITER_EPOCH: permission.value.writerEpoch,
        ERASURE_VERIFICATION_KEYS: JSON.stringify({
          'synthetic-built': pair.publicKey
            .export({ format: 'pem', type: 'spki' })
            .toString(),
        }),
        NODE_EXTRA_CA_CERTS: cert,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdout: Bun.file(join(primary.directory, 'app.log')),
      stderr: Bun.file(join(primary.directory, 'app-errors.log')),
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (app.exitCode !== null) throw new Error('Built app exited');
      try {
        const response = await fetch(`${appUrl}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    check(ready, 'Built app did not become admitted');
    runtime = postgres(primaryUrl.toString(), {
      max: 4,
      connect_timeout: 2,
      onnotice: () => {},
    });
    const ca = readFileSync(cert, 'utf8');
    const admitted = createAdmissionGuard({
      sql: runtime,
      url,
      token,
      epoch: permission.value.writerEpoch,
      keys: keys.verification,
      fetcher: ((input, init) =>
        fetch(input, { ...init, tls: { ca } })) as typeof fetch,
    });
    await admitted();
    check(true, 'Gateway credential and TLS probe refused');
    const probe = await fetch(`${appUrl}/api/health`, {
      headers: { [ADMISSION_CHALLENGE]: randomUUID() },
    });
    check(
      probe.status === 200,
      `Direct admitted probe returned ${probe.status}`,
    );
    check(
      probe.headers.has(ADMISSION_RESPONSE),
      'Built proxy did not attach an upstream admission receipt',
    );
    await probe.body?.cancel();
    gateway = Bun.serve({
      hostname: '127.0.0.1',
      port: gatewayPort,
      fetch: createAdmissionGateway(
        admitted,
        recoveryForwarder(`${appUrl}/`, `${publicOrigin}/`, keys.verification),
      ),
    });
    for (const path of [
      '/api/health',
      '/api/auth/session',
      '/api/account',
      '/manifest.json',
    ]) {
      const response = await fetch(`${publicOrigin}${path}`, {
        headers: { cookie: 'session=gate-session' },
        redirect: 'manual',
      });
      check(
        response.status === 200,
        `Admitted ${path} returned ${response.status}`,
      );
      check(
        !response.headers.has(ADMISSION_RESPONSE),
        'Internal admission proof escaped the gateway',
      );
      await response.body?.cancel();
    }
    const root = await fetch(publicOrigin, { redirect: 'manual' });
    check(
      root.status === 307 &&
        new URL(root.headers.get('location') ?? '', publicOrigin).href ===
          `${publicOrigin}/us/feed/top`,
      `Gateway redirect escaped its public origin: ${root.status} ${root.headers.get('location')}`,
    );
    await root.body?.cancel();
    await control.exclusive((lease) => lease.close());
    for (const path of [
      '/api/health',
      '/api/auth/session',
      '/api/account',
      '/manifest.json',
      '/us/account',
    ]) {
      const response = await fetch(`${publicOrigin}${path}`, {
        headers: { cookie: 'session=gate-session' },
        redirect: 'manual',
      });
      check(response.status === 503, `Closed gateway admitted ${path}`);
      check(
        response.headers.get('cache-control') === 'private, no-store',
        'Closed response was cacheable',
      );
      await response.body?.cancel();
      const direct = await fetch(`${appUrl}${path}`, {
        headers: { cookie: 'session=gate-session' },
        redirect: 'manual',
      });
      check(
        direct.status === 503,
        `Direct origin bypassed admission for ${path}`,
      );
      await direct.body?.cancel();
    }
    check(
      (await primary.sql`SELECT count(*)::int AS count FROM users`)[0].count ===
        1,
      'Admission testing changed account data',
    );
    failed = false;
    console.log(`Built recovery admission: ${passed} checks passed`);
  } finally {
    await gateway?.stop(true);
    await evidence?.stop(true);
    if (app?.exitCode === null) {
      app.kill();
      const timer = setTimeout(() => app?.kill('SIGKILL'), 5000);
      await app.exited;
      clearTimeout(timer);
    }
    await runtime?.end({ timeout: 1 });
    await Promise.all(stores.map((sql) => sql.end({ timeout: 1 })));
    await cache?.close();
    if (failed)
      console.error(`Protected built-app diagnostics: ${primary.directory}`);
    else await primary.stop();
    await independent?.stop();
    if (failed) {
      await primary.sql.end({ timeout: 1 });
      Bun.spawnSync(
        [
          join(process.env.PG_BIN ?? '', 'pg_ctl'),
          '-D',
          join(primary.directory, 'data'),
          '-m',
          'fast',
          '-w',
          'stop',
        ],
        { stdout: 'ignore', stderr: 'ignore' },
      );
    }
  }
}
if (import.meta.main)
  void main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Built recovery admission failed',
    );
    process.exitCode = 1;
  });
