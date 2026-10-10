import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { openJournalConfiguration } from '../../../scripts/erasure-journal/configuration';
import { readProtected, writeProtected } from '../../../scripts/lib/artifacts';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import {
  type ArchiveTools,
  artifactHash,
  captureEncryptedArchive,
  restoreEncryptedArchive,
} from '../../../scripts/lib/recovery-artifact';
import { startRedis } from '../../../scripts/lib/redis-sandbox';
import { migrate } from '../../../scripts/migrations';
import { runRecoveryCommand } from '../../../scripts/recover-account-state';
import { recoveryForwarder } from '../../../scripts/recovery-gateway';
import { createChallengeStore } from '../auth/challenges';
import {
  ADMISSION_CHALLENGE,
  ADMISSION_RESPONSE,
  createAdmissionGateway,
  createAdmissionGuard,
} from './admission';
import {
  canonical,
  digest,
  type JournalClient,
  type Signed,
} from './journal-contract';
import { createJournalClient, createJournalHandler } from './journal-http';
import {
  createPostgresJournal,
  initializeJournalStores,
  type JournalKeys,
} from './journal-postgres';
import { createRecoveryController } from './recovery';
import { assertAuthEpoch, authEpochKey, authFlowKey } from './recovery-auth';
import {
  type AdmissionAttestation,
  createRecoveryControl,
} from './recovery-control';
import { recoverySchema } from './recovery-database';
import type { RecoveryManifest } from './recovery-manifest';
import { recoveryRow } from './recovery-state';
import { createErasureService } from './service';

if (process.env.REQUIRE_ERASURE_TESTS === '1' && !process.env.PG_BIN)
  throw new Error('PG_BIN required for erasure tests');
const required =
  !!process.env.PG_BIN &&
  !!Bun.which('age') &&
  !!Bun.which('age-keygen') &&
  !!Bun.which('redis-server');
if (process.env.REQUIRE_ERASURE_TESTS === '1' && !required)
  throw new Error(
    'age, age-keygen and redis-server required for recovery tests',
  );

describe.skipIf(!required)(
  'executable recovery controller and external admission',
  () => {
    let primary: ReturnType<typeof startPostgres>;
    let independent: ReturnType<typeof startPostgres>;
    let cache: Awaited<ReturnType<typeof startRedis>>;
    let source: postgres.Sql;
    let stores: postgres.Sql[];
    let target: postgres.Sql;
    let journal: ReturnType<typeof createPostgresJournal>;
    let control: ReturnType<typeof createRecoveryControl>;
    let keys: JournalKeys;
    let journalId: string;
    let initialEpoch: string;
    let expected: Awaited<ReturnType<typeof recoverySchema>>;
    let server: ReturnType<typeof Bun.serve>;
    let url: string;
    let tokens: Map<'runtime' | 'recovery' | 'admission', string>;
    let bootstrap: Signed<AdmissionAttestation>;
    let artifact: Signed<RecoveryManifest>;
    let encrypted: string;
    let recipient: string;
    let identity: string;
    let time: number;
    let faultAt: string | undefined;
    let hook: (point: string) => Promise<void>;
    let live: postgres.Sql;
    let runtime: postgres.Sql;
    let state: {
      id: string;
      artifactHash: string | null;
      retiredRoles: string[];
      servingRole: string;
    };
    let pools: postgres.Sql[];
    let directory: string;
    const a = {
      id: 'session-a',
      userId: 'account-a',
      email: 'a@example.invalid',
    };
    const b = {
      id: 'session-b',
      userId: 'account-b',
      email: 'b@example.invalid',
    };
    const db = (name: string, username = 'postgres') => {
      const value = postgres({
        ...primary.options,
        database: name,
        username,
        max: 6,
        connect_timeout: 1,
      });
      pools.push(value);
      return value;
    };
    const tools = (name = 'postgres'): ArchiveTools => ({
      pgBin: process.env.PG_BIN ?? '',
      age: Bun.which('age') ?? '',
      connection: [
        '-h',
        primary.directory,
        '-p',
        String(primary.options.port),
        '-U',
        'postgres',
        '-d',
        name,
      ],
    });
    const grant = async (sql: postgres.Sql, role: string) => {
      await sql`GRANT USAGE ON SCHEMA public TO ${sql(role)}`;
      await sql`GRANT EXECUTE ON FUNCTION pg_control_system() TO ${sql(role)}`;
      await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql(role)}`;
      await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sql(role)}`;
      await sql`REVOKE INSERT, UPDATE, DELETE ON public.recovery_state, public.state_generation FROM ${sql(role)}`;
    };
    const controller = (sql = source) =>
      createRecoveryController({
        sql,
        control,
        journal,
        keys,
        redis: cache.redis,
        expected,
        now: () => new Date(time),
        fault: async (point) => {
          if (point === faultAt) {
            faultAt = undefined;
            throw new Error(`Synthetic crash: ${point}`);
          }
          await hook(point);
        },
      });
    const guard = (sql: postgres.Sql, epoch = bootstrap.value.writerEpoch) =>
      createAdmissionGuard({
        sql,
        url,
        token: tokens.get('runtime') ?? '',
        epoch,
        keys: keys.verification,
        allowLoopback: true,
      });
    const erasure = (transport?: JournalClient) =>
      createErasureService(live, {
        journal:
          transport ??
          createJournalClient({
            url,
            token: tokens.get('runtime') ?? '',
            journalId,
            keys: keys.verification,
            allowLoopback: true,
          }),
        journalId,
        epoch: bootstrap.value.writerEpoch,
        keys: keys.verification,
        proofSecret: 'synthetic-proof-secret'.repeat(3),
        admission: guard(live),
        now: () => new Date(time),
        deliver: async () => {},
      });
    const sessions = async () => {
      await source`INSERT INTO sessions (id,user_id,expires_at) VALUES (${a.id},${a.userId},'2030-01-01'), (${b.id},${b.userId},'2030-01-01') ON CONFLICT DO NOTHING`;
      await source`INSERT INTO email_verifications (id,email,code_digest,expires_at,ready) VALUES ('email-b',${b.email},${digest('synthetic-code')},'2030-01-01',true) ON CONFLICT DO NOTHING`;
      await source`INSERT INTO oauth_accounts (user_id,provider,provider_account_id,access_token,refresh_token,expires_at) VALUES (${b.userId},'synthetic','identity-b','old-access','old-refresh','2030-01-01') ON CONFLICT DO NOTHING`;
    };
    const boot = async () => {
      bootstrap = await controller().recover({
        id: randomUUID(),
        artifactHash: null,
        retiredRoles: ['old_worker'],
        servingRole: 'first_worker',
      });
      tokens.set('runtime', await control.credential(bootstrap.value.runId));
      live = db('postgres', 'first_worker');
      await sessions();
    };
    const capture = async (kind: 'selected' | 'full' = 'selected') => {
      encrypted = join(directory, `${randomUUID()}.dump.age`);
      artifact = await controller().capture((snapshot) =>
        captureEncryptedArchive(tools(), snapshot, recipient, encrypted, kind),
      );
      expect(artifact.value.artifactHash).toBe(await artifactHash(encrypted));
    };
    const prepareTarget = async () => {
      await source`CREATE DATABASE restored TEMPLATE template0`;
      target = db('restored');
      await migrate(target);
      await grant(target, 'next_worker');
      state = {
        id: randomUUID(),
        artifactHash: artifact.value.artifactHash,
        retiredRoles: ['first_worker'],
        servingRole: 'next_worker',
      };
      runtime = db('restored', 'next_worker');
    };
    const recover = async () => {
      const proof = await controller(target).recover({
        ...state,
        restore: () =>
          restoreEncryptedArchive(
            target,
            tools('restored'),
            encrypted,
            identity,
            artifact.value.artifactHash,
            directory,
            expected,
          ),
      });
      tokens.set('runtime', await control.credential(proof.value.runId));
      return proof;
    };
    const closed = async () => {
      expect((await control.current())?.admitted).toBe(false);
      let entered = 0;
      const gateway = createAdmissionGateway(guard(runtime), async () => {
        entered++;
        return Response.json({ private: true });
      });
      expect(
        (await gateway(new Request('http://example.invalid/api/private')))
          .status,
      ).toBe(503);
      expect(entered).toBe(0);
    };
    const suppress = async () => {
      await erasure().revoke(b, 'key-b');
      await source`INSERT INTO account_erasure_intents (operation_id, action, account_id, accepted_at, receipt_expires_at) VALUES (${randomUUID()},'erase_account',${a.userId},${new Date(time)},${new Date(time + 604800000)})`;
      expect(
        (await erasure().reconcilePending()).every(
          (row) => row.status === 'completed',
        ),
      ).toBe(true);
    };
    beforeAll(async () => {
      primary = startPostgres();
      independent = startPostgres();
      cache = await startRedis();
      source = postgres({ ...primary.options, max: 8 });
      stores = Array.from({ length: 4 }, () =>
        postgres({ ...independent.options, max: 6 }),
      );
      identity = join(primary.directory, 'synthetic.agekey');
      const gen = Bun.spawnSync(
        [Bun.which('age-keygen') ?? '', '-o', identity],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      if (gen.exitCode) throw new Error('Synthetic key generation failed');
      recipient = gen.stderr.toString().match(/age1[a-z0-9]+/)?.[0] ?? '';
    }, 30_000);
    beforeEach(async () => {
      pools = [];
      directory = join(primary.directory, randomUUID());
      mkdirSync(directory, { mode: 0o700 });
      time = Date.parse('2026-10-10T12:00:00.000Z');
      faultAt = undefined;
      hook = async () => {};
      await source.unsafe(
        'DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS podcst_migrations CASCADE; CREATE SCHEMA public',
      );
      for (const row of await source`SELECT rolname FROM pg_roles WHERE rolname LIKE '_recovery_retired_%'`) {
        await source`DROP OWNED BY ${source(row.rolname)}`;
        await source`DROP ROLE ${source(row.rolname)}`;
      }
      for (const role of ['old_worker', 'first_worker', 'next_worker']) {
        if (
          !(await source`SELECT 1 FROM pg_roles WHERE rolname = ${role}`).length
        )
          await source`CREATE ROLE ${source(role)} NOLOGIN`;
        await source`ALTER ROLE ${source(role)} NOLOGIN`;
      }
      await migrate(source);
      await grant(source, 'first_worker');
      await source`INSERT INTO users (id,email) VALUES (${a.userId},${a.email}),(${b.userId},${b.email})`;
      await source`INSERT INTO passkeys (id,user_id,credential_id,public_key) VALUES ('key-a',${a.userId},'credential-a',decode('12','hex')),('key-b',${b.userId},'credential-b',decode('34','hex')),('key-kept',${b.userId},'credential-kept',decode('56','hex'))`;
      await source`INSERT INTO authors (id,name) VALUES (1,'Synthetic')`;
      await source`INSERT INTO podcasts (id,author_id,title,cover,feed_url,owner_user_id) VALUES (1,1,'Public','','https://example.invalid/public',NULL),(2,1,'Private','','https://example.invalid/private',${a.userId})`;
      await source`INSERT INTO follow_clients (user_id,client_id,last_sequence,last_request_hash,last_result) VALUES (${b.userId},${randomUUID()},9007199254740993,'synthetic-hash','{"retained":true}')`;
      await sessions();
      for (const [kind, schema] of [
        ['journal', 'erasure_journal'],
        ['authority', 'erasure_authority'],
        ['receipts', 'erasure_receipts'],
      ] as const) {
        await stores[0].unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await stores[0].unsafe(
          readFileSync(
            new URL(
              `../../../scripts/erasure-journal/${kind}.sql`,
              import.meta.url,
            ),
            'utf8',
          ),
        );
      }
      journalId = randomUUID();
      initialEpoch = randomUUID();
      const pair = generateKeyPairSync('ed25519');
      keys = {
        current: 'synthetic',
        signing: pair.privateKey,
        verification: new Map([['synthetic', pair.publicKey]]),
        encryption: new Map([['synthetic', randomBytes(32)]]),
      };
      await initializeJournalStores(
        stores[0],
        stores[1],
        journalId,
        initialEpoch,
      );
      journal = createPostgresJournal(
        stores[0],
        stores[1],
        stores[2],
        journalId,
        keys,
        () => new Date(time),
      );
      control = createRecoveryControl(
        stores[3],
        journal,
        keys,
        () => new Date(time),
      );
      tokens = new Map(
        ['runtime', 'recovery', 'admission'].map((role) => [
          role as 'runtime' | 'recovery' | 'admission',
          randomBytes(32).toString('base64url'),
        ]),
      );
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: createJournalHandler(
          journal,
          new Map([
            ['recovery', tokens.get('recovery') ?? ''],
            ['admission', tokens.get('admission') ?? ''],
          ]),
          control,
        ),
      });
      url = `http://127.0.0.1:${server.port}/`;
      await cache.redis.flushdb();
      expected = await recoverySchema(source);
    });
    afterEach(async () => {
      await server?.stop(true);
      await Promise.all(pools.map((pool) => pool.end({ timeout: 1 })));
      await source`DROP DATABASE IF EXISTS restored WITH (FORCE)`;
    });
    afterAll(async () => {
      await source?.end({ timeout: 1 });
      await Promise.all(stores?.map((pool) => pool.end({ timeout: 1 })) ?? []);
      await cache?.close();
      await primary?.stop();
      await independent?.stop();
    }, 30_000);

    test.each([
      'selected',
      'full',
    ] as const)('%s encrypted checkpoint replays actual erasures before HTTP/cache admission', async (kind) => {
      await boot();
      const oldFlow = await createChallengeStore(
        cache.redis,
        async () => bootstrap.value.authEpoch,
      ).issue({ purpose: 'authentication', challenge: 'old-challenge' });
      const oldGeneration = (await source`SELECT * FROM state_generation`)[0];
      const streams = canonical(
        Array.from(await source`SELECT * FROM follow_clients`),
      );
      await capture(kind);
      await suppress();
      await prepareTarget();
      const proof = await recover();
      const admitted = guard(runtime, proof.value.writerEpoch);
      expect((await admitted()).incarnation).toBe(proof.value.incarnation);
      const gateway = createAdmissionGateway(admitted, async () =>
        Response.json({ cached: true }),
      );
      expect(
        (await gateway(new Request('http://example.invalid/api/private')))
          .status,
      ).toBe(200);
      expect(
        Array.from(await target`SELECT id FROM users ORDER BY id`),
      ).toEqual([{ id: b.userId }]);
      expect(
        Array.from(await target`SELECT id FROM passkeys ORDER BY id`),
      ).toEqual([{ id: 'key-kept' }]);
      expect(
        Array.from(await target`SELECT id::text FROM podcasts ORDER BY id`),
      ).toEqual([{ id: '1' }]);
      for (const table of [
        'sessions',
        'email_verifications',
        'account_erasure_proofs',
      ])
        expect(await target`SELECT 1 FROM ${target(table)}`).toHaveLength(0);
      expect(
        Array.from(
          await target`SELECT access_token,refresh_token,expires_at FROM oauth_accounts`,
        ),
      ).toEqual([
        { access_token: null, refresh_token: null, expires_at: null },
      ]);
      expect(
        canonical(Array.from(await target`SELECT * FROM follow_clients`)),
      ).toBe(streams);
      const generation = (await target`SELECT * FROM state_generation`)[0];
      expect(generation.generation).not.toBe(oldGeneration.generation);
      expect(generation.legacy_generation).toBe(
        oldGeneration.legacy_generation,
      );
      await expect(
        createChallengeStore(
          cache.redis,
          async () => (await admitted()).authEpoch,
        ).consume(oldFlow, { purpose: 'authentication' }),
      ).rejects.toThrow();
      await expect(guard(live)()).rejects.toThrow();
      await expect(
        journal.publish(bootstrap.value.writerEpoch, {
          version: 1,
          operationId: randomUUID(),
          accountId: b.userId,
          action: 'erase_account',
          acceptedAt: new Date(time).toISOString(),
        }),
      ).rejects.toThrow();
      expect((await recover()).value).toEqual(proof.value);
    }, 30_000);

    test.each([
      'after-restore',
      'after-apply',
      'after-watermark',
      'after-replay-commit',
      'after-provisional-open',
      'after-redis-retirement',
      'before-auth-commit',
      'after-auth-commit',
      'after-serving-open',
      'before-admit',
    ])('restart at %s stays closed and resumes without weakening constraints', async (point) => {
      await boot();
      await capture();
      await suppress();
      await prepareTarget();
      faultAt = point;
      await expect(recover()).rejects.toThrow();
      await closed();
      if (point === 'after-apply' || point === 'after-watermark') {
        expect((await recoveryRow(target))?.sequence).toBe(
          artifact.value.base.sequence,
        );
        expect(
          await target`SELECT 1 FROM passkeys WHERE id = 'key-b'`,
        ).toHaveLength(1);
      }
      control = createRecoveryControl(
        stores[3],
        journal,
        keys,
        () => new Date(time),
      );
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
      expect(
        await target`SELECT 1 FROM users WHERE id = ${a.userId}`,
      ).toHaveLength(0);
      expect(
        await target`SELECT 1 FROM passkeys WHERE id = 'key-b'`,
      ).toHaveLength(0);
      expect(
        await target`SELECT 1 FROM pg_trigger WHERE tgenabled <> 'O'`,
      ).toHaveLength(0);
    }, 30_000);

    test('a committed admission with lost controller acknowledgement finishes role enablement safely', async () => {
      await boot();
      await capture();
      await prepareTarget();
      faultAt = 'after-admit';
      await expect(recover()).rejects.toThrow();
      expect((await control.current())?.admitted).toBe(true);
      expect(
        (
          await target`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'next_worker'`
        )[0].rolcanlogin,
      ).toBe(false);
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
    }, 30_000);

    test('restored unpublished obligations reconcile after proof/receipt expiry under a gated provisional epoch', async () => {
      await boot();
      const unavailable = {
        ...journal,
        lookup: async () => {
          throw new Error('Synthetic outage');
        },
      };
      expect((await erasure(unavailable).revoke(b, 'key-b')).status).toBe(
        'pending',
      );
      await capture();
      time += 8 * 86_400_000;
      await prepareTarget();
      const proof = await recover();
      expect(proof.value.base.sequence).toBe('1');
      expect(
        await target`SELECT 1 FROM account_erasure_intents WHERE applied_at IS NULL`,
      ).toHaveLength(0);
      expect(
        Array.from(
          await target`SELECT id FROM passkeys WHERE user_id = ${b.userId} ORDER BY id`,
        ),
      ).toEqual([{ id: 'key-kept' }]);
    }, 30_000);

    test('nonzero conservative bases and overlapping coherent captures do not claim an asynchronous observed head', async () => {
      await source`INSERT INTO account_erasure_intents (operation_id,action,account_id,credential_id,accepted_at,receipt_expires_at) VALUES (${randomUUID()},'revoke_passkey',${b.userId},'key-b',${new Date(time)},${new Date(time + 604800000)})`;
      await boot();
      expect(bootstrap.value.base.sequence).toBe('1');
      const first = join(directory, 'first.age');
      const second = join(directory, 'second.age');
      const captures = await Promise.all([
        controller().capture((snapshot) =>
          captureEncryptedArchive(
            tools(),
            snapshot,
            recipient,
            first,
            'selected',
          ),
        ),
        controller().capture((snapshot) =>
          captureEncryptedArchive(tools(), snapshot, recipient, second, 'full'),
        ),
      ]);
      expect(captures.map((value) => value.value.base.sequence)).toEqual([
        '1',
        '1',
      ]);
      artifact = captures[0];
      encrypted = first;
      await source`INSERT INTO passkeys (id,user_id,credential_id,public_key) VALUES ('key-new',${b.userId},'credential-new',decode('12','hex'))`;
      await erasure().revoke(b, 'key-new');
      await prepareTarget();
      const proof = await recover();
      expect(proof.value.base.sequence).toBe('2');
    }, 30_000);

    test.each([
      'missing-key',
      'truncated',
      'corrupt',
      'stale-authority',
      'ineligible',
      'bad-digest',
      'redis-unavailable',
      'unsafe-schema',
    ])('%s evidence cannot open recovery', async (failure) => {
      await boot();
      await capture();
      await suppress();
      await prepareTarget();
      if (failure === 'missing-key')
        (keys.encryption as Map<string, Buffer>).clear();
      if (failure === 'truncated')
        await stores[0]`DELETE FROM erasure_journal.entries WHERE sequence = 1`;
      if (failure === 'corrupt')
        await stores[0]`UPDATE erasure_journal.entries SET body = set_byte(body, 0, get_byte(body, 0) # 1) WHERE sequence = 1`;
      if (failure === 'stale-authority')
        await stores[1]`UPDATE erasure_authority.head SET sequence = sequence + 1, revision = revision + 1`;
      if (failure === 'ineligible')
        await control.exclusive((lease) =>
          lease.retireArtifact(artifact.value.artifactHash),
        );
      if (failure === 'bad-digest')
        state.artifactHash = digest('unsupported artifact');
      if (failure === 'redis-unavailable') {
        const broken = createRecoveryController({
          sql: target,
          control,
          journal,
          keys,
          expected,
          redis: {
            get: async () => {
              throw new Error('Redis unavailable');
            },
            set: cache.redis.set.bind(cache.redis),
            scan: cache.redis.scan.bind(cache.redis),
            info: cache.redis.info.bind(cache.redis),
          },
          now: () => new Date(time),
        });
        await expect(
          broken.recover({
            ...state,
            restore: () =>
              restoreEncryptedArchive(
                target,
                tools('restored'),
                encrypted,
                identity,
                artifact.value.artifactHash,
                directory,
                expected,
              ),
          }),
        ).rejects.toThrow();
      } else {
        if (failure === 'unsafe-schema')
          await target`ALTER TABLE public.users ADD COLUMN unsupported TEXT`;
        await expect(recover()).rejects.toThrow();
      }
      await closed();
      expect(
        await target`SELECT 1 FROM pg_roles WHERE rolname = 'first_worker'`,
      ).toHaveLength(0);
      expect(
        await target`SELECT 1 FROM pg_roles WHERE rolname LIKE '_recovery_retired_%' AND rolcanlogin`,
      ).toHaveLength(0);
      expect(
        (
          await target`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'next_worker'`
        )[0].rolcanlogin,
      ).toBe(false);
    }, 30_000);

    test('restored readiness, old Redis markers and an unaccounted login role cannot substitute for external admission', async () => {
      await boot();
      await capture();
      await prepareTarget();
      await target`CREATE ROLE unaccounted LOGIN`;
      try {
        await expect(recover()).rejects.toThrow();
        await closed();
      } finally {
        await target`DROP ROLE unaccounted`;
      }
      const proof = await recover();
      await cache.redis.set(
        authEpochKey(proof.value.authEpoch),
        'restored-old-run',
      );
      await expect(
        assertAuthEpoch(
          cache.redis,
          proof.value.authEpoch,
          proof.value.runId,
          proof.value.redisIdentity,
        ),
      ).rejects.toThrow();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        proof.value.runId,
      );
      await cache.redis.set(
        authEpochKey(proof.value.authEpoch),
        proof.value.runId,
      );
      await target`UPDATE recovery_state SET incarnation = ${bootstrap.value.incarnation}`;
      await expect(guard(runtime, proof.value.writerEpoch)()).rejects.toThrow();
    }, 30_000);

    test('a cached authentic gate response cannot answer a fresh nonce', async () => {
      await boot();
      let cached: Response | undefined;
      const check = createAdmissionGuard({
        sql: live,
        url,
        token: tokens.get('runtime') ?? '',
        epoch: bootstrap.value.writerEpoch,
        keys: keys.verification,
        allowLoopback: true,
        fetcher: (async (input, init) => {
          cached ??= await fetch(input, init);
          return cached.clone();
        }) as typeof fetch,
      });
      await check();
      await expect(check()).rejects.toThrow();
    });

    test('publication storage outage fences only the requested credential on a healthy admitted primary', async () => {
      await boot();
      await stores[0]`ALTER TABLE erasure_journal.head RENAME TO unavailable_head`;
      expect((await erasure().revoke(b, 'key-b')).status).toBe('pending');
      expect((await guard(live)()).runId).toBe(bootstrap.value.runId);
      const flow = createChallengeStore(
        cache.redis,
        async () => (await guard(live)()).authEpoch,
      );
      const id = await flow.issue({
        purpose: 'authentication',
        challenge: 'fresh-unaffected-flow',
      });
      expect(await flow.consume(id, { purpose: 'authentication' })).toBe(
        'fresh-unaffected-flow',
      );
      expect(
        await live`SELECT 1 FROM sessions WHERE id = ${b.id}`,
      ).toHaveLength(1);
      expect(
        await live`SELECT 1 FROM passkeys WHERE id = 'key-kept'`,
      ).toHaveLength(1);
    });

    test('a real primary crash preserves committed replay watermarks and stays closed until revalidation', async () => {
      await boot();
      await capture();
      await suppress();
      await prepareTarget();
      faultAt = 'after-replay-commit';
      await expect(recover()).rejects.toThrow();
      await closed();
      const cursor = await recoveryRow(target);
      await source.end({ timeout: 1 });
      await Promise.all(pools.map((pool) => pool.end({ timeout: 1 })));
      pools = [];
      for (const args of [
        [
          '-D',
          join(primary.directory, 'data'),
          '-m',
          'immediate',
          '-w',
          'stop',
        ],
        [
          '-D',
          join(primary.directory, 'data'),
          '-l',
          join(primary.directory, 'restart.log'),
          '-o',
          `-k ${primary.directory} -p ${primary.options.port} -h ''`,
          '-w',
          'start',
        ],
      ]) {
        const command = Bun.spawnSync(
          [join(process.env.PG_BIN ?? '', 'pg_ctl'), ...args],
          { stdout: 'pipe', stderr: 'pipe' },
        );
        expect(command.exitCode).toBe(0);
      }
      source = postgres({ ...primary.options, max: 8 });
      target = db('restored');
      runtime = db('restored', 'next_worker');
      live = db('postgres', 'first_worker');
      expect((await recoveryRow(target))?.sequence).toBe(cursor?.sequence);
      await closed();
      await server.stop(true);
      control = createRecoveryControl(
        stores[3],
        journal,
        keys,
        () => new Date(time),
      );
      server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: createJournalHandler(
          journal,
          new Map([
            ['recovery', tokens.get('recovery') ?? ''],
            ['admission', tokens.get('admission') ?? ''],
          ]),
          control,
        ),
      });
      url = `http://127.0.0.1:${server.port}/`;
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
    }, 30_000);

    test('publication racing the seal is either suppressed before admission or refused under the retired epoch', async () => {
      await boot();
      await capture();
      await prepareTarget();
      let publication: ReturnType<typeof journal.publish> | undefined;
      hook = async (point) => {
        if (point === 'before-initial-seal') {
          publication = journal.publish(bootstrap.value.writerEpoch, {
            version: 1,
            operationId: randomUUID(),
            accountId: a.userId,
            action: 'erase_account',
            acceptedAt: new Date(time).toISOString(),
          });
          void publication.catch(() => {});
        }
      };
      const proof = await recover();
      const outcome = await publication?.then(
        (entry) => entry,
        () => null,
      );
      expect(
        await target`SELECT 1 FROM users WHERE id = ${a.userId}`,
      ).toHaveLength(outcome ? 0 : 1);
      if (outcome)
        expect(BigInt(proof.value.base.sequence)).toBeGreaterThanOrEqual(
          BigInt(outcome.value.sequence),
        );
      await expect(
        journal.publish(bootstrap.value.writerEpoch, {
          version: 1,
          operationId: randomUUID(),
          accountId: b.userId,
          action: 'erase_account',
          acceptedAt: new Date(time).toISOString(),
        }),
      ).rejects.toThrow();
    }, 30_000);

    test('deferred constraint failure rolls erasure and its watermark back without disabling the guard', async () => {
      await boot();
      await capture();
      await suppress();
      await prepareTarget();
      hook = async (point) => {
        if (point === 'before-initial-seal') {
          await target`CREATE TABLE synthetic_blocker (user_id TEXT REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED)`;
          await target`INSERT INTO synthetic_blocker VALUES (${a.userId})`;
        }
      };
      await expect(recover()).rejects.toThrow();
      await closed();
      expect((await recoveryRow(target))?.sequence).toBe('1');
      expect(
        await target`SELECT 1 FROM users WHERE id = ${a.userId}`,
      ).toHaveLength(1);
      expect(
        await target`SELECT 1 FROM pg_constraint WHERE conrelid = 'synthetic_blocker'::regclass AND convalidated`,
      ).toHaveLength(1);
    }, 30_000);

    test('a changed admission closes an overlapping capture before it can register eligibility', async () => {
      await boot();
      const path = join(directory, 'overlap.age');
      await expect(
        controller().capture(async (snapshot) => {
          const hash = await captureEncryptedArchive(
            tools(),
            snapshot,
            recipient,
            path,
            'selected',
          );
          await control.exclusive((lease) => lease.close());
          return hash;
        }),
      ).rejects.toThrow();
      expect(
        await stores[3]`SELECT 1 FROM erasure_authority.recovery_artifacts`,
      ).toHaveLength(0);
    });

    test('authentic stale heads cannot finish controller admission', async () => {
      await boot();
      await capture();
      const stale = await journal.seal(bootstrap.value.writerEpoch);
      const next = randomUUID();
      await journal.openEpoch(stale.value, next);
      await journal.publish(next, {
        version: 1,
        operationId: randomUUID(),
        accountId: a.userId,
        action: 'erase_account',
        acceptedAt: new Date(time).toISOString(),
      });
      journal = { ...journal, head: async () => stale };
      await prepareTarget();
      await expect(recover()).rejects.toThrow();
      await closed();
    }, 30_000);

    test('a retired writer epoch cannot be reused even by the epoch-management capability', async () => {
      await boot();
      const sealed = await journal.seal(bootstrap.value.writerEpoch);
      const next = randomUUID();
      await journal.openEpoch(sealed.value, next);
      const again = await journal.seal(next);
      await expect(
        journal.openEpoch(again.value, bootstrap.value.writerEpoch),
      ).rejects.toThrow();
    });

    test('retired runtime credentials cannot publish with the newly visible serving epoch', async () => {
      await boot();
      const oldToken = tokens.get('runtime') ?? '';
      await capture();
      await prepareTarget();
      const proof = await recover();
      expect(tokens.get('runtime')).not.toBe(oldToken);
      const stale = createJournalClient({
        url,
        token: oldToken,
        journalId,
        keys: keys.verification,
        allowLoopback: true,
      });
      await expect(
        stale.publish(proof.value.writerEpoch, {
          version: 1,
          operationId: randomUUID(),
          accountId: b.userId,
          action: 'erase_account',
          acceptedAt: new Date(time).toISOString(),
        }),
      ).rejects.toThrow();
      expect(
        JSON.stringify(
          await stores[3]`SELECT plan, runtime_digest, runtime_token FROM erasure_authority.recovery_runs`,
        ),
      ).not.toContain(oldToken);
    }, 30_000);

    test('the external gateway refuses legacy or replayed upstream receipts and strips verified proof headers', async () => {
      await boot();
      const admitted = guard(live);
      let mode = 'valid';
      let saved = '';
      const upstream = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const proof = await admitted(
            request.headers.get(ADMISSION_CHALLENGE) ?? '',
          );
          const fresh = Buffer.from(JSON.stringify(proof.response)).toString(
            'base64url',
          );
          if (!saved) saved = fresh;
          return Response.json(
            { cached: 'synthetic-private' },
            {
              headers:
                mode === 'missing'
                  ? {}
                  : { [ADMISSION_RESPONSE]: mode === 'stale' ? saved : fresh },
            },
          );
        },
      });
      try {
        const gateway = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          fetch: createAdmissionGateway(
            admitted,
            recoveryForwarder(
              `http://127.0.0.1:${upstream.port}/`,
              'https://example.invalid/',
              keys.verification,
            ),
          ),
        });
        try {
          const response = await fetch(
            `http://127.0.0.1:${gateway.port}/api/private`,
          );
          expect(response.status).toBe(200);
          expect(response.headers.has(ADMISSION_RESPONSE)).toBe(false);
          expect(await response.json()).toEqual({
            cached: 'synthetic-private',
          });
          for (const next of ['missing', 'stale']) {
            mode = next;
            const refused = await fetch(
              `http://127.0.0.1:${gateway.port}/api/private`,
            );
            expect(refused.status).toBe(503);
            expect(await refused.text()).not.toContain('synthetic-private');
          }
        } finally {
          await gateway.stop(true);
        }
      } finally {
        await upstream.stop(true);
      }
    }, 30_000);

    test('Redis rollback cannot revive a consumed challenge; explicit auth rotation preserves current primary data', async () => {
      await boot();
      const oldEpoch = bootstrap.value.authEpoch;
      const original = createChallengeStore(cache.redis, async () => oldEpoch);
      const flow = await original.issue({
        purpose: 'authentication',
        challenge: 'old-challenge',
      });
      const value = await cache.redis.get(authFlowKey(oldEpoch, flow));
      expect(await original.consume(flow, { purpose: 'authentication' })).toBe(
        'old-challenge',
      );
      await cache.close();
      cache = await startRedis();
      await cache.redis.set(authEpochKey(oldEpoch), bootstrap.value.runId);
      await cache.redis.set(
        authFlowKey(oldEpoch, flow),
        value ?? '',
        'EX',
        300,
      );
      await expect(
        assertAuthEpoch(
          cache.redis,
          oldEpoch,
          bootstrap.value.runId,
          bootstrap.value.redisIdentity,
        ),
      ).rejects.toThrow();
      expect((await guard(live)()).runId).toBe(bootstrap.value.runId);
      expect((await erasure().revoke(b, 'key-b')).status).toBe('completed');
      await grant(source, 'next_worker');
      const proof = await controller().recover({
        id: randomUUID(),
        mode: 'auth-rotation',
        artifactHash: bootstrap.value.artifactHash,
        retiredRoles: ['first_worker'],
        servingRole: 'next_worker',
      });
      tokens.set('runtime', await control.credential(proof.value.runId));
      const active = guard(
        db('postgres', 'next_worker'),
        proof.value.writerEpoch,
      );
      const challenge = createChallengeStore(cache.redis, async () => {
        const permission = await active();
        await assertAuthEpoch(
          cache.redis,
          permission.authEpoch,
          permission.runId,
          permission.redisIdentity,
        );
        return permission.authEpoch;
      });
      await expect(
        challenge.consume(flow, { purpose: 'authentication' }),
      ).rejects.toThrow();
      expect(await source`SELECT 1 FROM users`).toHaveLength(2);
      expect(await source`SELECT 1 FROM sessions`).toHaveLength(0);
      expect(proof.value.authEpoch).not.toBe(oldEpoch);
      expect(await cache.redis.get(authFlowKey(oldEpoch, flow))).toBe(value);
    }, 30_000);

    test('operator entrypoints execute reference, bootstrap, encrypted capture and isolated recovery without ambient targets', async () => {
      const names = ['cli_journal', 'cli_authority', 'cli_receipts'];
      const connections: postgres.Sql[] = [];
      try {
        for (let i = 0; i < names.length; i++) {
          await stores[0]`CREATE DATABASE ${stores[0](names[i])} TEMPLATE template0`;
          const db = postgres({ ...independent.options, database: names[i] });
          connections.push(db);
          await db.unsafe(
            readFileSync(
              new URL(
                `../../../scripts/erasure-journal/${['journal', 'authority', 'receipts'][i]}.sql`,
                import.meta.url,
              ),
              'utf8',
            ),
          );
        }
        const id = randomUUID();
        await initializeJournalStores(
          connections[0],
          connections[1],
          id,
          randomUUID(),
        );
        const configuration = join(directory, 'journal.json');
        const address = (name: string) =>
          `postgres://postgres@localhost:${independent.options.port}/${name}?host=${encodeURIComponent(independent.directory)}`;
        writeProtected(configuration, {
          port: 3123,
          journalId: id,
          databases: {
            journal: address(names[0]),
            authority: address(names[1]),
            receipts: address(names[2]),
          },
          tokens: {
            recovery: tokens.get('recovery'),
            admission: tokens.get('admission'),
          },
          keys: {
            current: keys.current,
            signing: keys.signing
              .export({ type: 'pkcs8', format: 'pem' })
              .toString(),
            versions: [
              {
                id: keys.current,
                encryption: keys.encryption
                  .get(keys.current)
                  ?.toString('base64'),
                verification: keys.verification
                  .get(keys.current)
                  ?.export({ type: 'spki', format: 'pem' })
                  .toString(),
              },
            ],
          },
        });
        const reference = join(directory, 'reference.json');
        const refConfig = join(directory, 'reference-config.json');
        writeProtected(refConfig, {
          pgBin: process.env.PG_BIN,
          output: reference,
        });
        await runRecoveryCommand('reference', refConfig);
        const base = {
          pgBin: process.env.PG_BIN,
          age: Bun.which('age'),
          primary: {
            socket: primary.directory,
            port: primary.options.port,
            database: 'postgres',
            role: 'postgres',
          },
          journalConfiguration: configuration,
          redisUrl: cache.url,
          reference,
        };
        const first = join(directory, 'bootstrap-result.json');
        const bootConfig = join(directory, 'bootstrap-config.json');
        writeProtected(bootConfig, {
          ...base,
          output: first,
          run: {
            id: randomUUID(),
            retiredRoles: ['old_worker'],
            servingRole: 'first_worker',
          },
        });
        await runRecoveryCommand('bootstrap', bootConfig);
        const started = readProtected(first) as {
          attestation: Signed<AdmissionAttestation>;
          runtimeToken: string;
        };
        expect(started.runtimeToken.length).toBe(43);
        const cipher = join(directory, 'cli.age');
        const manifestPath = join(directory, 'cli-manifest.json');
        const captureConfig = join(directory, 'capture-config.json');
        writeProtected(captureConfig, {
          ...base,
          output: manifestPath,
          artifact: { path: cipher, recipient, kind: 'selected' },
        });
        await runRecoveryCommand('capture', captureConfig);
        const manifest = readProtected(
          manifestPath,
        ) as Signed<RecoveryManifest>;
        expect(manifest.value.artifactHash).toBe(await artifactHash(cipher));
        const backend = await openJournalConfiguration(configuration);
        try {
          await backend.journal.publish(started.attestation.value.writerEpoch, {
            version: 1,
            operationId: randomUUID(),
            accountId: a.userId,
            action: 'erase_account',
            acceptedAt: new Date().toISOString(),
          });
        } finally {
          await backend.close();
        }
        await source`CREATE DATABASE restored TEMPLATE template0`;
        target = db('restored');
        await migrate(target);
        await grant(target, 'next_worker');
        const output = join(directory, 'recovered.json');
        const recoverConfig = join(directory, 'recover-config.json');
        writeProtected(recoverConfig, {
          ...base,
          primary: { ...base.primary, database: 'restored' },
          output,
          run: {
            id: randomUUID(),
            retiredRoles: ['first_worker'],
            servingRole: 'next_worker',
          },
          artifact: { path: cipher, identity, scratch: directory },
        });
        await runRecoveryCommand('recover', recoverConfig);
        const result = readProtected(output) as {
          attestation: Signed<AdmissionAttestation>;
          runtimeToken: string;
        };
        expect(result.attestation.value.artifactHash).toBe(
          manifest.value.artifactHash,
        );
        expect(result.runtimeToken === started.runtimeToken).toBe(false);
        expect(
          await target`SELECT 1 FROM users WHERE id = ${a.userId}`,
        ).toHaveLength(0);
        expect(
          await target`SELECT 1 FROM users WHERE id = ${b.userId}`,
        ).toHaveLength(1);
      } finally {
        await Promise.all(connections.map((db) => db.end({ timeout: 1 })));
        for (const name of names)
          await stores[0]`DROP DATABASE IF EXISTS ${stores[0](name)} WITH (FORCE)`;
      }
    }, 30_000);

    test('controller exclusion and runtime publication fencing hold while recovery is closed', async () => {
      await boot();
      await capture();
      await prepareTarget();
      await control.exclusive(async (lease) => {
        await lease.close();
        await expect(control.exclusive(async () => {})).rejects.toThrow();
        const client = createJournalClient({
          url,
          token: tokens.get('runtime') ?? '',
          journalId,
          keys: keys.verification,
          allowLoopback: true,
        });
        await expect(
          client.publish(bootstrap.value.writerEpoch, {
            version: 1,
            operationId: randomUUID(),
            accountId: a.userId,
            action: 'erase_account',
            acceptedAt: new Date(time).toISOString(),
          }),
        ).rejects.toThrow();
        await expect(guard(live)()).rejects.toThrow();
      });
    }, 30_000);
  },
);
