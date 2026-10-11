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
import { grantJournalStore } from '../../../scripts/erasure-journal/permissions';
import { createAgeFixture } from '../../../scripts/lib/age-fixture';
import { readProtected, writeProtected } from '../../../scripts/lib/artifacts';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import {
  type ArchiveTools,
  artifactHash,
  captureEncryptedArchive,
  restoreEncryptedArchive,
} from '../../../scripts/lib/recovery-artifact';
import { startRedis } from '../../../scripts/lib/redis-sandbox';
import { createTLSFixture } from '../../../scripts/lib/tls-fixture';
import { loadMigrations, migrate } from '../../../scripts/migrations';
import { runRecoveryCommand } from '../../../scripts/recover-account-state';
import { recoveryForwarder } from '../../../scripts/recovery-gateway';
import { grantPrimaryRole } from '../../../scripts/recovery-permissions';
import {
  captureSchema,
  compareSchemas,
  inventoryArtifact,
} from '../../../scripts/schema-catalog';
import { createChallengeStore } from '../auth/challenges';
import { createEmailService } from '../auth/email-service';
import { refreshTopCharts } from '../ingest/charts';
import { upsertEpisodes } from '../ingest/episodes';
import { requestFeedRefresh } from '../ingest/feed-demand';
import { savePollState } from '../ingest/feed-refresh';
import { createEpisodeListService } from '../lists/service';
import { createFollowStateService } from '../state/follows';
import { createProgressStateService } from '../state/progress';
import { evictWarm } from '../tiering';
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
  signValue,
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
  !!Bun.which('redis-server') &&
  !!Bun.which('openssl');
if (process.env.REQUIRE_ERASURE_TESTS === '1' && !required)
  throw new Error(
    'age, age-keygen, redis-server and openssl required for recovery tests',
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
    let initialEncrypted: string;
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
      const [identity] = await sql`SELECT current_database() AS database`;
      await grantPrimaryRole(sql, 'serving', {
        database: identity.database,
        role,
        reference: await recoverySchema(sql),
      });
    };
    const reorderDescription = async () => {
      const snapshot = await captureSchema(source);
      const definition = snapshot.objects.find(
        (object) =>
          object.kind === 'index' &&
          object.parent === 'podcasts' &&
          object.name === 'idx_podcasts_search',
      )?.definition.definition;
      if (typeof definition !== 'string')
        throw new Error('Synthetic index definition missing');
      await source`ALTER TABLE podcasts DROP COLUMN description CASCADE`;
      await source`ALTER TABLE podcasts ADD COLUMN historical_slot TEXT`;
      await source`ALTER TABLE podcasts DROP COLUMN historical_slot`;
      await source`ALTER TABLE podcasts ADD COLUMN description TEXT`;
      await source`UPDATE podcasts SET description = 'retained-description-' || id::text`;
      await source.unsafe(definition);
      return snapshot;
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
    const bootstrapInput = (id: string = randomUUID()) => ({
      id,
      artifactHash: null,
      retiredRoles: ['old_worker'],
      servingRole: 'first_worker',
      initialCheckpoint: (snapshot: string) => {
        initialEncrypted = join(directory, `${randomUUID()}.initial.dump.age`);
        return captureEncryptedArchive(
          tools(),
          snapshot,
          recipient,
          initialEncrypted,
          'full',
        );
      },
    });
    const boot = async () => {
      bootstrap = await controller().recover(bootstrapInput());
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
      await source`REVOKE CONNECT, TEMPORARY ON DATABASE restored FROM PUBLIC`;
      await source`GRANT CONNECT ON DATABASE restored TO next_worker`;
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
    const restartPrimary = async () => {
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
      ])
        expect(
          Bun.spawnSync([join(process.env.PG_BIN ?? '', 'pg_ctl'), ...args], {
            stdout: 'pipe',
            stderr: 'pipe',
          }).exitCode,
        ).toBe(0);
      source = postgres({ ...primary.options, max: 8 });
    };
    const serveJournal = () => {
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
      const operationId = randomUUID();
      await source`INSERT INTO account_erasure_intents (operation_id, action, account_id, accepted_at, receipt_expires_at, next_attempt_at) VALUES (${operationId},'erase_account',${a.userId},${new Date(time)},${new Date(time + 604800000)},${new Date(time)})`;
      expect(await erasure().reconcilePending()).toEqual([
        { operationId, status: 'completed' },
      ]);
    };
    beforeAll(async () => {
      primary = startPostgres();
      independent = startPostgres();
      cache = await startRedis();
      source = postgres({ ...primary.options, max: 8 });
      await source`REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC`;
      stores = Array.from({ length: 4 }, () =>
        postgres({ ...independent.options, max: 6 }),
      );
      ({ identity, recipient } = createAgeFixture(primary.directory));
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
          await source`CREATE ROLE ${source(role)} NOLOGIN NOINHERIT`;
        await source`ALTER ROLE ${source(role)} NOLOGIN NOINHERIT`;
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
      serveJournal();
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

    test('physical column order and dropped slots stay visible in inventory but preserve named-column encrypted recovery', async () => {
      const original = await reorderDescription();
      const reordered = await captureSchema(source);
      const raw = compareSchemas(
        inventoryArtifact(
          original,
          loadMigrations().map(({ name, checksum }) => ({ name, checksum })),
        ),
        inventoryArtifact(reordered),
      );
      expect(raw.schemaMatches).toBe(false);
      expect(raw.changed).toHaveLength(1);
      expect(raw.changed[0].key).toBe(
        '["column","public","podcasts","description"]',
      );
      expect(await recoverySchema(source)).toEqual(expected);
      const values = Array.from(
        await source`SELECT id::text, title, description, feed_url, author_id FROM podcasts ORDER BY id`,
      );
      const streams = canonical(
        Array.from(await source`SELECT * FROM follow_clients`),
      );
      const legacy = (
        await source`SELECT legacy_generation FROM state_generation`
      )[0].legacy_generation;
      await boot();
      await capture('full');
      await prepareTarget();
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
      expect(
        Array.from(
          await target`SELECT id::text, title, description, feed_url, author_id FROM podcasts ORDER BY id`,
        ),
      ).toEqual(values);
      expect(
        canonical(Array.from(await target`SELECT * FROM follow_clients`)),
      ).toBe(streams);
      expect(
        (await target`SELECT legacy_generation FROM state_generation`)[0]
          .legacy_generation,
      ).toBe(legacy);
      const restored = await captureSchema(target);
      const position = (snapshot: typeof restored) =>
        snapshot.objects.find(
          (object) =>
            object.kind === 'column' &&
            object.parent === 'podcasts' &&
            object.name === 'description',
        )?.definition.position;
      expect(position(restored)).toBe(position(original));
      expect(position(restored)).not.toBe(position(reordered));
      expect(await recoverySchema(target)).toEqual(expected);
    }, 30_000);

    test('authentic artifacts cannot mix catalogue fingerprint definitions across capture and recovery', async () => {
      await boot();
      await capture('full');
      const oldReference = signValue(
        { ...bootstrap.value, catalogHash: 'd'.repeat(64) },
        keys.current,
        keys.signing,
      );
      await stores[3]`UPDATE erasure_authority.recovery_runs SET attestation = ${stores[3].json(JSON.parse(canonical(oldReference)))} WHERE id = ${bootstrap.value.runId}`;
      await expect(
        controller().recover(bootstrapInput(bootstrap.value.runId)),
      ).rejects.toThrow();
      let exported = false;
      await expect(
        controller().capture(async () => {
          exported = true;
          return 'a'.repeat(64);
        }),
      ).rejects.toThrow();
      expect(exported).toBe(false);
      await prepareTarget();
      await expect(recover()).rejects.toThrow();
      expect(await target`SELECT id FROM users`).toHaveLength(0);
      expect((await control.current())?.admitted).toBe(false);
    });

    test('logical view projection order remains part of the recovery fingerprint', async () => {
      await source.unsafe(
        "CREATE VIEW synthetic_projection AS SELECT 'left'::text AS first, 'right'::text AS second",
      );
      const first = await recoverySchema(source);
      await source`DROP VIEW synthetic_projection`;
      await source.unsafe(
        "CREATE VIEW synthetic_projection AS SELECT 'right'::text AS second, 'left'::text AS first",
      );
      expect((await recoverySchema(source)).catalogHash).not.toBe(
        first.catalogHash,
      );
      await source`DROP VIEW synthetic_projection`;
    });

    test.each([
      'type',
      'nullability',
      'default',
      'constraint',
      'index',
      'trigger',
      'routine',
      'extra-column',
    ])('reordered columns do not hide %s drift from recovery admission', async (kind) => {
      await reorderDescription();
      expect(await recoverySchema(source)).toEqual(expected);
      if (kind === 'type')
        await source`ALTER TABLE podcasts ALTER COLUMN description TYPE varchar(2048)`;
      if (kind === 'nullability')
        await source`ALTER TABLE podcasts ALTER COLUMN description SET NOT NULL`;
      if (kind === 'default')
        await source`ALTER TABLE podcasts ALTER COLUMN description SET DEFAULT 'unapproved'`;
      if (kind === 'constraint')
        await source`ALTER TABLE podcasts DROP CONSTRAINT podcasts_author_id_fkey`;
      if (kind === 'index') await source`DROP INDEX idx_podcasts_search`;
      if (kind === 'trigger')
        await source`ALTER TABLE podcasts DISABLE TRIGGER recovery_admission`;
      if (kind === 'routine')
        await source.unsafe(
          'CREATE OR REPLACE FUNCTION guard_erasure_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',
        );
      if (kind === 'extra-column')
        await source`ALTER TABLE podcasts ADD COLUMN unexpected TEXT`;
      await expect(controller().recover(bootstrapInput())).rejects.toThrow();
      expect((await control.current())?.admitted).not.toBe(true);
    });

    test('bootstrap without an initial capture refuses before retiring roles or authentication', async () => {
      const { initialCheckpoint: _capture, ...input } = bootstrapInput();
      await expect(controller().recover(input)).rejects.toThrow();
      expect(
        await source`SELECT 1 FROM pg_roles WHERE rolname = 'old_worker'`,
      ).toHaveLength(1);
      expect(await source`SELECT id FROM sessions`).toHaveLength(2);
      expect(
        await stores[3]`SELECT 1 FROM erasure_authority.recovery_runs`,
      ).toHaveLength(0);
    });

    test.each([
      'before-initial-capture',
      'after-initial-capture',
      'before-admit',
    ])('bootstrap interruption at %s stays closed across a primary restart and resumes the same run', async (point) => {
      const input = bootstrapInput();
      faultAt = point;
      await expect(controller().recover(input)).rejects.toThrow();
      expect((await control.current())?.admitted).toBe(false);
      expect(
        await stores[3]`SELECT 1 FROM erasure_authority.recovery_artifacts`,
      ).toHaveLength(0);
      expect(
        (
          await source`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'first_worker'`
        )[0].rolcanlogin,
      ).toBe(false);
      await restartPrimary();
      bootstrap = await controller().recover(input);
      tokens.set('runtime', await control.credential(bootstrap.value.runId));
      live = db('postgres', 'first_worker');
      expect((await guard(live)()).runId).toBe(input.id);
      const eligible = await control.artifact(
        await artifactHash(initialEncrypted),
        expected.schemaHash,
        journalId,
      );
      expect(eligible.origin.runId).toBe(input.id);
      expect(
        await stores[3]`SELECT 1 FROM erasure_authority.recovery_artifacts`,
      ).toHaveLength(1);
    }, 30_000);

    test('initial eligibility and admission roll back together when the authority commit refuses', async () => {
      const input = bootstrapInput();
      await stores[3]`ALTER TABLE erasure_authority.recovery_runs ADD CONSTRAINT synthetic_admission_failure CHECK (NOT admitted)`;
      await expect(controller().recover(input)).rejects.toThrow();
      const failedHash = await artifactHash(initialEncrypted);
      expect((await control.current())?.admitted).toBe(false);
      expect(
        await stores[3]`SELECT 1 FROM erasure_authority.recovery_artifacts`,
      ).toHaveLength(0);
      await stores[3]`ALTER TABLE erasure_authority.recovery_runs DROP CONSTRAINT synthetic_admission_failure`;
      bootstrap = await controller().recover(input);
      const saved = await artifactHash(initialEncrypted);
      expect(saved).not.toBe(failedHash);
      expect(
        (await control.artifact(saved, expected.schemaHash, journalId)).origin
          .runId,
      ).toBe(input.id);
      await expect(
        control.artifact(failedHash, expected.schemaHash, journalId),
      ).rejects.toThrow();
    });

    test('lost bootstrap acknowledgement resumes without creating another initial archive', async () => {
      const input = bootstrapInput();
      faultAt = 'after-admit';
      await expect(controller().recover(input)).rejects.toThrow();
      expect((await control.current())?.admitted).toBe(true);
      const saved = await artifactHash(initialEncrypted);
      const result = await controller().recover({
        ...input,
        initialCheckpoint: async () => {
          throw new Error('Unexpected second capture');
        },
      });
      expect(result.value.runId).toBe(input.id);
      expect(
        (await control.artifact(saved, expected.schemaHash, journalId)).origin
          .runId,
      ).toBe(input.id);
      expect(
        await stores[3]`SELECT 1 FROM erasure_authority.recovery_artifacts`,
      ).toHaveLength(1);
    });

    test('a restart immediately after first admission recovers from its mandatory full checkpoint', async () => {
      const input = bootstrapInput();
      faultAt = 'after-admit';
      await expect(controller().recover(input)).rejects.toThrow();
      const current = await control.current();
      expect(current?.admitted).toBe(true);
      bootstrap = current?.attestation as Signed<AdmissionAttestation>;
      encrypted = initialEncrypted;
      const [saved] =
        await stores[3]`SELECT manifest FROM erasure_authority.recovery_artifacts`;
      artifact = saved.manifest;
      await restartPrimary();
      await expect(controller().recover(input)).rejects.toThrow();
      await prepareTarget();
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
      expect(await target`SELECT id FROM users`).toHaveLength(2);
      expect(await target`SELECT id FROM sessions`).toHaveLength(0);
    }, 30_000);

    test('restricted serving grants support authentication, B state, list changes and F2 worker SQL', async () => {
      await boot();
      let code = '';
      const email = createEmailService(
        live,
        'synthetic-secret'.repeat(4),
        async (_email, value) => {
          code = value;
        },
      );
      await email.send('new@example.invalid');
      expect(await email.login('new@example.invalid', code)).not.toBeNull();
      await upsertEpisodes(live, '1', '', [
        {
          guid: 'grant-episode',
          title: 'Grant episode',
          summary: null,
          published: Date.now(),
          cover: '',
          explicit: false,
          duration: 60,
          link: null,
          file: {
            url: 'https://example.invalid/audio.mp3',
            length: 100,
            type: 'audio/mpeg',
          },
          author: null,
          episodeArt: null,
          showNotes: '',
        },
      ]);
      const [episode] =
        await live`SELECT id::text FROM episodes WHERE guid = 'grant-episode'`;
      const scope = {
        protocol: 1 as const,
        accountId: b.userId,
        generation: bootstrap.value.generation,
      };
      const follows = createFollowStateService(live);
      const follow = {
        ...scope,
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ podcastId: '1', followed: true }],
      };
      expect((await follows.change(b.userId, follow)).revision).toBe('1');
      expect((await follows.change(b.userId, follow)).revision).toBe('1');
      expect((await follows.read(b.userId)).items).toHaveLength(1);
      await follows.change(b.userId, {
        ...follow,
        sequence: '2',
        changes: [{ podcastId: '1', followed: false }],
      });
      const progress = createProgressStateService(live);
      const change = {
        ...scope,
        clientId: randomUUID(),
        sequence: '1',
        changes: [
          { episodeId: episode.id, positionSeconds: 42, completed: false },
        ],
      };
      expect((await progress.change(b.userId, change)).revision).toBe('1');
      expect((await progress.change(b.userId, change)).revision).toBe('1');
      expect(
        (await progress.read(b.userId, [episode.id])).items[0].progress
          ?.positionSeconds,
      ).toBe(42);
      const lists = createEpisodeListService(live);
      const list = (await lists.lists(b.userId)).lists[0];
      const batch = {
        ...scope,
        clientId: randomUUID(),
        sequence: '1',
        changes: [{ op: 'add' as const, episodeId: episode.id }],
      };
      expect((await lists.change(b.userId, list.id, batch)).revision).toBe('1');
      expect((await lists.membership(b.userId, list.id)).items).toHaveLength(1);
      await lists.change(b.userId, list.id, {
        ...batch,
        sequence: '2',
        changes: [{ op: 'remove', episodeId: episode.id }],
      });
      expect(
        (
          await requestFeedRefresh(live, '1', null, async () => {
            await guard(live)();
          })
        )?.state,
      ).toBe('pending');
      await savePollState(
        live,
        '1',
        { etag: 'synthetic', lastModified: null, hash: 'synthetic' },
        3600,
      );
      await source`SELECT setval('authors_id_seq', 1), setval('podcasts_id_seq', 2)`;
      const chart = [
        {
          itunesId: '700',
          author: 'Grant author',
          feed: 'https://example.invalid/chart',
          title: 'Grant chart',
          cover: '',
          thumbnail: null,
          explicit: false,
          count: 1,
          rank: 1,
          verifiedAt: new Date().toISOString(),
          genres: [26],
        },
      ];
      for (let index = 0; index < 2; index++) {
        const result = await refreshTopCharts(live, ['zz'], async () => chart);
        expect(result.failedLocales).toEqual([]);
        expect(result.stored).toBe(1);
      }
      expect(
        await live`SELECT 1 FROM chart_history WHERE country_id = 'zz'`,
      ).toHaveLength(1);
      expect(await live`SELECT 1 FROM poll_metrics`).toHaveLength(8);
      expect(await evictWarm(0, live)).toBe(1);
      expect((await erasure().revoke(b, 'key-b')).status).toBe('completed');
      expect(
        await live`SELECT id FROM passkeys WHERE id = 'key-kept'`,
      ).toHaveLength(1);
    });

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
      await source`INSERT INTO account_erasure_intents (operation_id,action,account_id,credential_id,accepted_at,receipt_expires_at,next_attempt_at) VALUES (${randomUUID()},'revoke_passkey',${b.userId},'key-b',${new Date(time)},${new Date(time + 604800000)},${new Date(time)})`;
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
      await target`GRANT CONNECT ON DATABASE restored TO unaccounted`;
      try {
        await expect(recover()).rejects.toThrow();
        await closed();
      } finally {
        await target`REVOKE CONNECT ON DATABASE restored FROM unaccounted`;
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
      await restartPrimary();
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
      serveJournal();
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
    }, 30_000);

    test('a reconnected stale worker cannot write after an admitted primary restarts', async () => {
      await boot();
      await live`UPDATE passkeys SET counter = 7 WHERE id = 'key-kept'`;
      await restartPrimary();
      live = db('postgres', 'first_worker');
      await expect(
        live`UPDATE passkeys SET counter = 8 WHERE id = 'key-kept'`.execute(),
      ).rejects.toThrow('Recovery admission required');
      expect(
        (await source`SELECT counter FROM passkeys WHERE id = 'key-kept'`)[0]
          .counter,
      ).toBe(7);
      await expect(guard(live)()).rejects.toThrow();
      await grant(source, 'next_worker');
      await expect(
        controller().recover({
          id: randomUUID(),
          mode: 'auth-rotation',
          artifactHash: bootstrap.value.artifactHash,
          retiredRoles: ['first_worker'],
          servingRole: 'next_worker',
        }),
      ).rejects.toThrow();
      expect((await control.current())?.admitted).toBe(false);
    }, 30_000);

    test('one-cluster store restart stays closed until full encrypted recovery into a fresh database', async () => {
      const names = ['journal', 'authority', 'receipts'] as const;
      const openStores = () => {
        const clients = names.map((name) =>
          db(`colocated_${name}`, `colocated_${name}`),
        );
        journal = createPostgresJournal(
          clients[0],
          clients[1],
          clients[2],
          journalId,
          keys,
          () => new Date(time),
        );
        control = createRecoveryControl(
          clients[1],
          journal,
          keys,
          () => new Date(time),
        );
        serveJournal();
      };
      await server.stop(true);
      await source`REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`;
      await source`GRANT CONNECT ON DATABASE postgres TO first_worker`;
      try {
        const admins = [];
        for (const name of names) {
          const database = `colocated_${name}`;
          await source`CREATE ROLE ${source(database)} NOLOGIN NOINHERIT`;
          await source`CREATE DATABASE ${source(database)} TEMPLATE template0`;
          const admin = db(database);
          admins.push(admin);
          await admin.unsafe(
            readFileSync(
              new URL(
                `../../../scripts/erasure-journal/${name}.sql`,
                import.meta.url,
              ),
              'utf8',
            ),
          );
          await grantJournalStore(admin, name, { database, role: database });
          await source`ALTER ROLE ${source(database)} LOGIN`;
        }
        await initializeJournalStores(
          admins[0],
          admins[1],
          journalId,
          initialEpoch,
        );
        openStores();
        await boot();
        const generation = (
          await source`SELECT generation, legacy_generation FROM state_generation`
        )[0];
        const streams = canonical(
          Array.from(await source`SELECT * FROM follow_clients`),
        );
        await capture('full');
        expect((await erasure().revoke(b, 'key-b')).status).toBe('completed');
        const retainedHead = await journal.head();
        expect(retainedHead.value.sequence).toBe('1');
        await server.stop(true);
        await restartPrimary();
        openStores();
        expect(await journal.head()).toEqual(retainedHead);
        live = db('postgres', 'first_worker');
        await expect(
          live`UPDATE passkeys SET counter = 8 WHERE id = 'key-kept'`.execute(),
        ).rejects.toThrow('Recovery admission required');
        await expect(guard(live)()).rejects.toThrow();
        let forwarded = 0;
        const request = new Request('http://example.invalid/api/private');
        const gateway = createAdmissionGateway(guard(live), async () => {
          forwarded++;
          return Response.json({ cached: true });
        });
        expect((await gateway(request)).status).toBe(503);
        expect(forwarded).toBe(0);
        await prepareTarget();
        for (const name of names) {
          const role = `colocated_${name}`;
          for (const database of [
            'postgres',
            'restored',
            ...names.map((n) => `colocated_${n}`),
          ]) {
            const [access] =
              await source`SELECT has_database_privilege(${role}, ${database}, 'CONNECT') AS allowed`;
            expect(access.allowed).toBe(database === role);
          }
        }
        const proof = await recover();
        expect(proof.value.database.startedAt).not.toBe(
          bootstrap.value.database.startedAt,
        );
        expect(proof.value.database.cluster).toBe(
          bootstrap.value.database.cluster,
        );
        expect(proof.value.database.oid).not.toBe(bootstrap.value.database.oid);
        expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
          state.id,
        );
        expect(await target`SELECT id FROM users`).toHaveLength(2);
        expect(
          await target`SELECT id FROM passkeys WHERE id = 'key-b'`,
        ).toHaveLength(0);
        expect(
          await target`SELECT id FROM passkeys WHERE id = 'key-kept'`,
        ).toHaveLength(1);
        expect(await target`SELECT id FROM sessions`).toHaveLength(0);
        expect(await target`SELECT id FROM podcasts`).toHaveLength(2);
        expect(
          canonical(Array.from(await target`SELECT * FROM follow_clients`)),
        ).toBe(streams);
        const current = (
          await target`SELECT generation, legacy_generation FROM state_generation`
        )[0];
        expect(current.generation).not.toBe(generation.generation);
        expect(current.legacy_generation).toBe(generation.legacy_generation);
        await expect(
          guard(runtime, bootstrap.value.writerEpoch)(),
        ).rejects.toThrow();
        await runtime`UPDATE passkeys SET counter = 42 WHERE id = 'key-kept'`;
        expect(
          (await target`SELECT counter FROM passkeys WHERE id = 'key-kept'`)[0]
            .counter,
        ).toBe(42);
      } finally {
        await server.stop(true);
        await Promise.all(pools.map((pool) => pool.end({ timeout: 1 })));
        pools = [];
        for (const name of names) {
          await source`DROP DATABASE IF EXISTS ${source(`colocated_${name}`)} WITH (FORCE)`;
          await source`DROP ROLE IF EXISTS ${source(`colocated_${name}`)}`;
        }
        await source`GRANT CONNECT ON DATABASE postgres TO PUBLIC`;
      }
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
      const initial = Array.from(
        await stores[3]`SELECT digest FROM erasure_authority.recovery_artifacts`,
      );
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
        Array.from(
          await stores[3]`SELECT digest FROM erasure_authority.recovery_artifacts`,
        ),
      ).toEqual(initial);
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

    test('operator entrypoints execute reference, bootstrap, capture and recovery with mutual TLS and constrained Redis ACLs', async () => {
      const tls = createTLSFixture(directory);
      await cache.close();
      cache = await startRedis({ tls });
      const password = randomUUID();
      await cache.redis.acl(
        'SETUSER',
        'controller',
        'on',
        `>${password}`,
        '~auth:epoch:*',
        '~auth:flow:*',
        '+get',
        '+set',
        '+scan',
        '+info',
        '+client|setinfo',
      );
      const cacheUrl = new URL(cache.url);
      cacheUrl.username = 'controller';
      cacheUrl.password = password;
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
          redis: {
            url: cacheUrl.toString(),
            tls: {
              ca: readFileSync(tls.ca, 'utf8'),
              cert: readFileSync(tls.client.cert, 'utf8'),
              key: readFileSync(tls.client.key, 'utf8'),
            },
          },
          reference,
        };
        const first = join(directory, 'bootstrap-result.json');
        const bootConfig = join(directory, 'bootstrap-config.json');
        const bootstrapInput = {
          ...base,
          initialCheckpoint: {
            path: join(directory, 'initial.dump.age'),
            recipient,
          },
          output: first,
          run: {
            id: randomUUID(),
            retiredRoles: ['old_worker'],
            servingRole: 'first_worker',
          },
        };
        writeProtected(bootConfig, bootstrapInput);
        const refusedConfig = join(directory, 'missing-client-identity.json');
        writeProtected(refusedConfig, {
          ...bootstrapInput,
          redis: { url: base.redis.url, tls: { ca: base.redis.tls.ca } },
        });
        await expect(
          runRecoveryCommand('bootstrap', refusedConfig),
        ).rejects.toThrow();
        const inspection = await openJournalConfiguration(configuration);
        try {
          expect((await inspection.control.current())?.admitted).toBe(false);
          expect(
            (
              await source`SELECT rolcanlogin FROM pg_roles WHERE rolname = 'first_worker'`
            )[0].rolcanlogin,
          ).toBe(false);
        } finally {
          await inspection.close();
        }
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
        await source`REVOKE CONNECT, TEMPORARY ON DATABASE restored FROM PUBLIC`;
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

    test('column-level control writes and replication bypass privileges refuse admission', async () => {
      await boot();
      await capture();
      await prepareTarget();
      await target`GRANT UPDATE (auth_epoch) ON recovery_state TO next_worker`;
      await expect(recover()).rejects.toThrow();
      await closed();
      await target`REVOKE UPDATE (auth_epoch) ON recovery_state FROM next_worker`;
      await target`GRANT SET ON PARAMETER session_replication_role TO next_worker`;
      try {
        await expect(recover()).rejects.toThrow();
        await closed();
      } finally {
        await target`REVOKE SET ON PARAMETER session_replication_role FROM next_worker`;
      }
      const proof = await recover();
      expect((await guard(runtime, proof.value.writerEpoch)()).runId).toBe(
        state.id,
      );
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
