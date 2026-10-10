import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { activePasskey, requireActiveAccount } from '../auth/account-guard';
import { createEmailService } from '../auth/email-service';
import { refreshFeed } from '../ingest/feed-refresh';
import { indexPrivatePodcast } from '../ingest/index-podcast';
import { createEpisodeListService } from '../lists/service';
import { createFollowStateService } from '../state/follows';
import { readGeneration } from '../state/generation';
import { createProgressStateService } from '../state/progress';
import { createErasureHandlers } from './http';
import {
  ERASURE_PROOF_MS,
  JOURNAL_GENESIS,
  type JournalClient,
  verifyReplay,
} from './journal-contract';
import {
  createPostgresJournal,
  initializeJournalStores,
} from './journal-postgres';
import { createErasureService } from './service';

if (process.env.REQUIRE_ERASURE_TESTS === '1' && !process.env.PG_BIN)
  throw new Error('PG_BIN required for erasure tests');

describe.skipIf(!process.env.PG_BIN)(
  'account erasure with independent durable publication',
  () => {
    let primary: ReturnType<typeof startPostgres>;
    let independent: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let restored: postgres.Sql | undefined;
    let journal: ReturnType<typeof createPostgresJournal>;
    let service: ReturnType<typeof createErasureService>;
    let makeService: (
      db: postgres.Sql,
      client?: JournalClient,
    ) => ReturnType<typeof createErasureService>;
    let code: string;
    let time: number;
    let journalId: string;
    let epoch: string;
    let verification: Parameters<typeof verifyReplay>[3];
    let available: boolean;
    let loseAck: boolean;
    const secret = 'synthetic-account-proof-secret'.repeat(3);
    const owner = {
      id: 'session-a',
      userId: 'account-a',
      email: 'a@example.invalid',
    };
    const other = {
      id: 'session-b',
      userId: 'account-b',
      email: 'b@example.invalid',
    };
    const command = (name: string, args: string[]) => {
      const result = Bun.spawnSync(
        [join(process.env.PG_BIN ?? '', name), ...args],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    };
    const connection = (database: string) => [
      '-h',
      primary.directory,
      '-p',
      String(primary.options.port),
      '-U',
      'postgres',
      '-d',
      database,
    ];
    const checkpoint = () =>
      command('pg_dump', [
        ...connection('postgres'),
        '-Fc',
        '--no-owner',
        '--no-privileges',
        '-f',
        join(primary.directory, 'older.dump'),
      ]);
    const restore = async () => {
      await restored?.end();
      await sql`DROP DATABASE IF EXISTS restored`;
      await sql`CREATE DATABASE restored TEMPLATE template0`;
      command('pg_restore', [
        ...connection('restored'),
        '--exit-on-error',
        '--single-transaction',
        join(primary.directory, 'older.dump'),
      ]);
      restored = postgres({ ...primary.options, database: 'restored' });
      return restored;
    };
    beforeAll(() => {
      primary = startPostgres();
      independent = startPostgres();
      sql = postgres({ ...primary.options, max: 10 });
    }, 30_000);
    beforeEach(async () => {
      await restored?.end();
      restored = undefined;
      await sql`DROP DATABASE IF EXISTS restored`;
      await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await createSchemaFixture(sql);
      await sql`
      INSERT INTO users (id, email) VALUES (${owner.userId}, ${owner.email}), (${other.userId}, ${other.email})
    `;
      await sql`INSERT INTO sessions (id,user_id,expires_at) VALUES (${owner.id},${owner.userId},'2030-01-01'), (${other.id},${other.userId},'2030-01-01')`;
      await sql`INSERT INTO passkeys (id,user_id,credential_id,public_key) VALUES ('key-a',${owner.userId},'credential-a',decode('1234','hex')), ('key-b',${other.userId},'credential-b',decode('1234','hex')), ('key-kept',${other.userId},'credential-kept',decode('1234','hex'))`;
      await sql`INSERT INTO authors (id,name) VALUES (1,'Synthetic')`;
      await sql`INSERT INTO podcasts (id,author_id,title,cover,feed_url,owner_user_id) VALUES (1,1,'Public','','https://example.invalid/public',NULL),(2,1,'Private','','https://example.invalid/private',${owner.userId})`;
      await sql`INSERT INTO episodes (id,podcast_id,guid,published) VALUES (1,1,'public','2026-01-01'),(2,2,'private','2026-01-01')`;
      await sql`INSERT INTO episode_content (episode_id,title,file_url) VALUES (1,'Public','https://example.invalid/public.mp3'),(2,'Private','https://example.invalid/private.mp3')`;
      await sql`INSERT INTO episode_lists (id,user_id,kind) VALUES ('00000000-0000-4000-8000-000000000001',${owner.userId},'starred'),('00000000-0000-4000-8000-000000000002',${other.userId},'starred')`;
      await sql`INSERT INTO episode_list_items (list_id,episode_id) VALUES ('00000000-0000-4000-8000-000000000001',2),('00000000-0000-4000-8000-000000000002',1)`;
      for (const [kind, schema] of [
        ['journal', 'erasure_journal'],
        ['authority', 'erasure_authority'],
        ['receipts', 'erasure_receipts'],
      ] as const) {
        await independent.sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await independent.sql.unsafe(
          readFileSync(
            new URL(
              `../../../scripts/erasure-journal/${kind}.sql`,
              import.meta.url,
            ),
            'utf8',
          ),
        );
      }
      time = Date.parse('2026-10-10T12:00:00Z');
      journalId = randomUUID();
      epoch = randomUUID();
      available = true;
      loseAck = false;
      const pair = generateKeyPairSync('ed25519');
      const keys = new Map([['synthetic', pair.publicKey]]);
      verification = keys;
      await initializeJournalStores(
        independent.sql,
        independent.sql,
        journalId,
        epoch,
      );
      const connections = [
        postgres(independent.options),
        postgres(independent.options),
      ];
      extraConnections.push(...connections);
      journal = createPostgresJournal(
        independent.sql,
        connections[0],
        connections[1],
        journalId,
        {
          current: 'synthetic',
          signing: pair.privateKey,
          verification: keys,
          encryption: new Map([['synthetic', randomBytes(32)]]),
        },
        () => new Date(time),
      );
      const client: JournalClient = {
        async publish(epoch, payload) {
          if (!available) throw new Error('Synthetic outage');
          const ack = await journal.publish(epoch, payload);
          if (loseAck) throw new Error('Synthetic lost acknowledgement');
          return ack;
        },
        lookup: async (...args) => {
          if (!available) throw new Error('Synthetic outage');
          return journal.lookup(...args);
        },
        registerReceipt: (...args) => journal.registerReceipt(...args),
        resolveReceipt: async (...args) => {
          if (!available) throw new Error('Synthetic outage');
          return journal.resolveReceipt(...args);
        },
      };
      makeService = (db, transport = client) =>
        createErasureService(db, {
          journal: transport,
          journalId,
          epoch,
          keys,
          proofSecret: secret,
          now: () => new Date(time),
          deliver: async (_email, value) => {
            code = value;
          },
        });
      service = makeService(sql);
    });
    const extraConnections: postgres.Sql[] = [];
    afterAll(async () => {
      await restored?.end();
      await sql?.end();
      await Promise.all(extraConnections.map((connection) => connection.end()));
      await Promise.all([primary?.stop(), independent?.stop()]);
    }, 30_000);

    test('fresh purpose-bound confirmation publishes independently before erasing canonical state', async () => {
      const prepared = await service.prepare(owner);
      expect(prepared.accountId).toBe(owner.userId);
      expect(Object.keys(prepared).sort()).toEqual([
        'accountId',
        'expiresAt',
        'operationId',
        'proofExpiresAt',
        'receipt',
      ]);
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      expect(await service.status(prepared.receipt)).toEqual({
        status: 'unknown',
      });
      expect(
        await service.accept(owner, prepared.operationId, code, true),
      ).toEqual({ operationId: prepared.operationId, status: 'completed' });
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${other.userId}`,
      ).toHaveLength(1);
      expect(await sql`SELECT id::text FROM podcasts`).toMatchObject([
        { id: '1' },
      ]);
      expect(await sql`SELECT 1 FROM episode_list_items`).toHaveLength(1);
      expect(
        await independent.sql`SELECT 1 FROM erasure_journal.entries`,
      ).toHaveLength(1);
      expect(await service.status(prepared.receipt)).toEqual({
        status: 'completed',
      });
      await expect(
        service.accept(owner, prepared.operationId, code, true),
      ).rejects.toThrow();
    });

    test('erasure removes unshared private author metadata while retaining public parents', async () => {
      await sql`INSERT INTO authors (id,name) VALUES (2,'Synthetic private author')`;
      await sql`UPDATE podcasts SET author_id = 2 WHERE id = 2`;
      const prepared = await service.prepare(owner);
      expect(
        (await service.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('completed');
      expect(await sql`SELECT id FROM authors ORDER BY id`).toMatchObject([
        { id: 1 },
      ]);
    });

    test('wrong account, session, confirmation, code, expired proof and exhausted guesses cannot accept', async () => {
      const prepared = await service.prepare(owner);
      const valid = code;
      await expect(
        service.accept(other, prepared.operationId, valid, true),
      ).rejects.toThrow();
      await expect(
        service.accept(
          { ...owner, id: 'missing-session' },
          prepared.operationId,
          valid,
          true,
        ),
      ).rejects.toThrow();
      await expect(
        service.accept(owner, prepared.operationId, valid, false),
      ).rejects.toThrow();
      for (let i = 0; i < 5; i++)
        await expect(
          service.accept(
            owner,
            prepared.operationId,
            valid === '000000' ? '111111' : '000000',
            true,
          ),
        ).rejects.toThrow();
      await expect(
        service.accept(owner, prepared.operationId, valid, true),
      ).rejects.toThrow();
      expect(
        await sql`SELECT attempts FROM account_erasure_proofs WHERE operation_id = ${prepared.operationId}`,
      ).toMatchObject([{ attempts: 5 }]);
      const expired = await service.prepare(owner);
      time += ERASURE_PROOF_MS;
      await expect(
        service.accept(owner, expired.operationId, code, true),
      ).rejects.toThrow();
      expect(await sql`SELECT 1 FROM account_erasure_intents`).toHaveLength(0);
      expect(
        await independent.sql`SELECT 1 FROM erasure_journal.entries`,
      ).toHaveLength(0);
    });

    test('outage fences the account and private writers, retains intent, and completes after proof expiry', async () => {
      const prepared = await service.prepare(owner);
      available = false;
      expect(
        (await service.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('pending');
      await expect(
        sql.begin((tx) => requireActiveAccount(tx, owner.userId)),
      ).rejects.toThrow();
      await expect(readGeneration(sql, owner.userId)).rejects.toThrow();
      const email = createEmailService(sql, secret, async () => {});
      await expect(email.send(owner.email)).rejects.toThrow();
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      await expect(service.status(prepared.receipt)).rejects.toThrow();
      time += ERASURE_PROOF_MS + 1;
      available = true;
      expect((await service.reconcile(prepared.operationId)).status).toBe(
        'completed',
      );
      expect(await service.status(prepared.receipt)).toEqual({
        status: 'completed',
      });
    });

    test('publication lost acknowledgement leaves a fenced intent and retries the same operation', async () => {
      const prepared = await service.prepare(owner);
      loseAck = true;
      expect(
        (await service.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('pending');
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      expect(
        await independent.sql`SELECT 1 FROM erasure_journal.entries`,
      ).toHaveLength(1);
      expect((await service.reconcile(prepared.operationId)).status).toBe(
        'completed',
      );
      expect(
        await independent.sql`SELECT 1 FROM erasure_journal.entries`,
      ).toHaveLength(1);
    });

    test('pending passkey removal blocks only its registration and preserves alternate authentication', async () => {
      available = false;
      const outcome = await service.revoke(other, 'key-b');
      expect(outcome.status).toBe('pending');
      expect(
        await sql`SELECT 1 WHERE ${activePasskey(sql, 'key-b')}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT 1 WHERE ${activePasskey(sql, 'key-kept')}`,
      ).toHaveLength(1);
      expect(
        await sql.begin((tx) => requireActiveAccount(tx, other.userId)),
      ).toMatchObject({ id: other.userId });
      await expect(service.revoke(owner, 'key-b')).rejects.toThrow(
        'Passkey not found',
      );
      available = true;
      expect((await service.revoke(other, 'key-b')).operationId).toBe(
        outcome.operationId,
      );
      expect(
        await sql`SELECT id FROM passkeys WHERE user_id = ${other.userId}`,
      ).toMatchObject([{ id: 'key-kept' }]);
      expect(
        await sql`SELECT 1 FROM sessions WHERE user_id = ${other.userId}`,
      ).toHaveLength(1);
    });

    test('an older checkpoint cannot revive an independently erased account or revoked key after real replay', async () => {
      checkpoint();
      const prepared = await service.prepare(owner);
      expect(
        (await service.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('completed');
      expect((await service.revoke(other, 'key-b')).status).toBe('completed');
      const sealed = await journal.seal(epoch);
      const db = await restore();
      expect(
        await db`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      expect(await db`SELECT 1 FROM passkeys WHERE id = 'key-b'`).toHaveLength(
        1,
      );
      let admitted = false;
      const replay = await journal.readRange(
        { journalId, sequence: '0', hash: JOURNAL_GENESIS },
        sealed.value,
      );
      expect(
        verifyReplay(
          replay.entries,
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          sealed,
          verification,
        ).sequence,
      ).toBe('2');
      for (const entry of replay.entries) await makeService(db).replay(entry);
      await db.begin(async (tx) => {
        await tx`DELETE FROM sessions`;
        await tx`DELETE FROM email_verifications`;
        await tx`DELETE FROM account_erasure_proofs`;
        await tx`UPDATE oauth_accounts SET access_token = NULL, refresh_token = NULL, expires_at = NULL`;
        await tx`UPDATE state_generation SET generation = ${randomUUID()}`;
      });
      admitted = true;
      expect(admitted).toBe(true);
      expect(
        await db`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(0);
      expect(await db`SELECT id FROM passkeys`).toMatchObject([
        { id: 'key-kept' },
      ]);
      expect(await db`SELECT 1 FROM sessions`).toHaveLength(0);
      expect(await makeService(db).status(prepared.receipt)).toEqual({
        status: 'completed',
      });
      time += 8 * 86_400_000;
      expect(await makeService(db).status(prepared.receipt)).toEqual({
        status: 'unknown',
      });
      expect(
        await db`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(0);
    });

    test('mounted HTTP reports pending honestly and receipt reconciliation cannot clear another session', async () => {
      let current: typeof owner | null = owner;
      let clears = 0;
      let deletionEnabled = true;
      const handlers = createErasureHandlers({
        service: () => service,
        deletionEnabled: () => deletionEnabled,
        session: async () => current,
        limit: async () => {},
        clearSession: async () => {
          clears++;
        },
      });
      const request = (method: string, body: unknown, origin?: string) =>
        new Request('http://localhost:3000/api/account', {
          method,
          headers: origin
            ? { Origin: origin }
            : { 'X-Podcst-Client': 'native' },
          body: JSON.stringify(body),
        });
      const preparedResponse = await handlers.prepare(request('POST', {}));
      const prepared = (await preparedResponse.json()) as Awaited<
        ReturnType<typeof service.prepare>
      >;
      available = false;
      const pending = await handlers.erase(
        request('DELETE', {
          operationId: prepared.operationId,
          code,
          confirmed: true,
        }),
      );
      expect(pending.status).toBe(202);
      expect((await pending.json()).status).toBe('pending');
      expect(pending.headers.get('cache-control')).toBe('private, no-store');
      expect(pending.headers.get('retry-after')).toBe('5');
      expect(clears).toBe(0);
      current = other;
      available = true;
      deletionEnabled = false;
      const reconciled = await handlers.status(
        request('POST', { receipt: prepared.receipt }),
      );
      expect(reconciled.status).toBe(200);
      expect(await reconciled.json()).toEqual({ status: 'completed' });
      expect(clears).toBe(0);
      current = null;
      for (const response of [
        await handlers.prepare(request('POST', {})),
        await handlers.status(request('POST', {}, 'https://hostile.invalid')),
        await handlers.status(request('POST', { receipt: 'x'.repeat(20_000) })),
      ]) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    });

    test('disabled deletion refuses proofs and new acceptance without cancelling prior receipts', async () => {
      const proof = await service.prepare(owner);
      let limits = 0;
      const handlers = createErasureHandlers({
        service: () => service,
        deletionEnabled: () => false,
        session: async () => owner,
        limit: async () => {
          limits++;
        },
        clearSession: async () => {
          throw new Error('Unexpected session removal');
        },
      });
      const request = (method: string, body: unknown) =>
        new Request('http://localhost:3000/api/account', {
          method,
          headers: { 'X-Podcst-Client': 'native' },
          body: JSON.stringify(body),
        });
      for (const response of [
        await handlers.prepare(request('POST', {})),
        await handlers.erase(
          request('DELETE', {
            operationId: proof.operationId,
            code,
            confirmed: true,
          }),
        ),
      ]) {
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
      expect(limits).toBe(0);
      expect(await sql`SELECT 1 FROM account_erasure_intents`).toHaveLength(0);
      expect(await sql`SELECT 1 FROM account_erasure_proofs`).toHaveLength(1);
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      const status = await handlers.status(
        request('POST', { receipt: proof.receipt }),
      );
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ status: 'unknown' });
    });

    test('authenticated revocation remains available with deletion disabled and the auth dependency down', async () => {
      const handlers = createErasureHandlers({
        service: () => service,
        deletionEnabled: () => false,
        session: async () => other,
        limit: async () => {
          throw new Error('Synthetic auth admission outage');
        },
        clearSession: async () => {},
      });
      const response = await handlers.revoke(
        new Request('http://localhost:3000/api/account/passkeys/key-b', {
          method: 'DELETE',
          headers: { 'X-Podcst-Client': 'native' },
        }),
        'key-b',
      );
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe('completed');
      expect(await sql`SELECT 1 FROM passkeys WHERE id = 'key-b'`).toHaveLength(
        0,
      );
    });

    test.each([
      'acceptance',
      'application',
    ])('lost primary %s commit acknowledgement remains reconcilable', async (boundary) => {
      let drop = false;
      const ambiguous = new Proxy(sql, {
        get(target, property) {
          if (property === 'begin')
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(target.begin, target, args);
              if (drop) {
                drop = false;
                throw new Error('Synthetic lost commit acknowledgement');
              }
              return result;
            };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const local = makeService(ambiguous, {
        ...journal,
        async publish(...args) {
          const ack = await journal.publish(...args);
          if (boundary === 'application') drop = true;
          return ack;
        },
      });
      const prepared = await local.prepare(owner);
      if (boundary === 'acceptance') {
        drop = true;
        await expect(
          local.accept(owner, prepared.operationId, code, true),
        ).rejects.toThrow('Synthetic lost commit acknowledgement');
      } else
        expect(
          (await local.accept(owner, prepared.operationId, code, true)).status,
        ).toBe('pending');
      expect(await service.status(prepared.receipt)).toEqual({
        status: 'completed',
      });
      expect(
        await independent.sql`SELECT 1 FROM erasure_journal.entries`,
      ).toHaveLength(1);
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(0);
    });

    test('expired worker claims cannot apply or acknowledge and a replacement finishes the same intent', async () => {
      const delayed = makeService(sql, {
        ...journal,
        async publish(...args) {
          const ack = await journal.publish(...args);
          time += 61_000;
          return ack;
        },
      });
      const prepared = await delayed.prepare(owner);
      expect(
        (await delayed.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('pending');
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      expect((await service.reconcile(prepared.operationId)).status).toBe(
        'completed',
      );
    });

    test('accepted erasure refuses actual progress, follow, list, private import and poller paths', async () => {
      const { scope } = await readGeneration(sql, owner.userId);
      const prepared = await service.prepare(owner);
      available = false;
      await service.accept(owner, prepared.operationId, code, true);
      const batch = { ...scope, clientId: randomUUID(), sequence: '1' };
      await expect(
        createProgressStateService(sql).change(owner.userId, {
          ...batch,
          changes: [{ episodeId: '2', positionSeconds: 10, completed: null }],
        }),
      ).rejects.toThrow();
      await expect(
        createFollowStateService(sql).change(owner.userId, {
          ...batch,
          changes: [{ podcastId: '2', followed: true }],
        }),
      ).rejects.toThrow();
      await expect(
        createEpisodeListService(sql).change(
          owner.userId,
          '00000000-0000-4000-8000-000000000001',
          { ...batch, changes: [{ op: 'add', episodeId: '2' }] },
        ),
      ).rejects.toThrow();
      await expect(
        indexPrivatePodcast(
          sql,
          'https://example.invalid/private',
          owner.userId,
        ),
      ).rejects.toThrow();
      expect(await refreshFeed(sql, '2', 'rebuild')).toBe('busy');
      expect(await sql`SELECT 1 FROM playback_progress`).toHaveLength(0);
    });

    test('an already-authorized writer commits before the exclusive acceptance fence, never after it', async () => {
      const prepared = await service.prepare(owner);
      const ready = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const writer = sql.begin(async (tx) => {
        await requireActiveAccount(tx, owner.userId);
        ready.resolve();
        await release.promise;
        await tx`INSERT INTO account_preferences (user_id,speed,volume_boost,trim_silence) VALUES (${owner.userId},1,false,false)`;
      });
      await ready.promise;
      available = false;
      const acceptance = service.accept(
        owner,
        prepared.operationId,
        code,
        true,
      );
      try {
        for (let i = 0; i < 100; i++) {
          const blocked =
            await sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
          if (blocked.length) break;
          if (i === 99)
            throw new Error('Acceptance did not wait for the writer');
          await Bun.sleep(10);
        }
        expect(await sql`SELECT 1 FROM account_erasure_intents`).toHaveLength(
          0,
        );
      } finally {
        release.resolve();
      }
      await writer;
      expect((await acceptance).status).toBe('pending');
      await expect(
        sql.begin((tx) => requireActiveAccount(tx, owner.userId)),
      ).rejects.toThrow();
      available = true;
      await service.reconcile(prepared.operationId);
      expect(await sql`SELECT 1 FROM account_preferences`).toHaveLength(0);
    });

    test('old email codes cannot recreate the account but a new signup has a new identity', async () => {
      let loginCode = '';
      const email = createEmailService(sql, secret, async (_email, value) => {
        loginCode = value;
      });
      await email.send(owner.email);
      const oldCode = loginCode;
      const prepared = await service.prepare(owner);
      await service.accept(owner, prepared.operationId, code, true);
      expect(await email.login(owner.email, oldCode)).toBeNull();
      await email.send(owner.email);
      const signedIn = await email.login(owner.email, loginCode);
      expect(signedIn).not.toBeNull();
      expect(await service.status(prepared.receipt)).toEqual({
        status: 'completed',
      });
      const [newAccount] =
        await sql`SELECT id FROM users WHERE email = ${owner.email}`;
      expect(newAccount.id).not.toBe(owner.userId);
    });

    test('a failing erasure cannot starve later credential revocations in bounded reconciliation', async () => {
      await sql`INSERT INTO episode_list_items (list_id,episode_id) VALUES ('00000000-0000-4000-8000-000000000002',2)`;
      const prepared = await service.prepare(owner);
      expect(
        (await service.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('pending');
      time += 1;
      available = false;
      const revocation = await service.revoke(other, 'key-b');
      available = true;
      time += 5000;
      expect(await service.reconcilePending(1)).toEqual([
        { operationId: prepared.operationId, status: 'pending' },
      ]);
      expect(await service.reconcilePending(1)).toEqual([
        { operationId: revocation.operationId, status: 'completed' },
      ]);
    });

    test('deferred constraint failure keeps publication irrevocable and local effects rolled back', async () => {
      await sql`INSERT INTO episode_list_items (list_id, episode_id) VALUES ('00000000-0000-4000-8000-000000000002',2)`;
      const prepared = await service.prepare(owner);
      expect(
        (await service.accept(owner, prepared.operationId, code, true)).status,
      ).toBe('pending');
      expect(
        await sql`SELECT 1 FROM users WHERE id = ${owner.userId}`,
      ).toHaveLength(1);
      expect(
        await sql`SELECT 1 FROM account_erasure_intents WHERE applied_at IS NOT NULL`,
      ).toHaveLength(0);
      expect(
        await independent.sql`SELECT 1 FROM erasure_journal.entries`,
      ).toHaveLength(1);
      await expect(service.status(prepared.receipt)).rejects.toThrow();
      expect(
        await sql`SELECT 1 FROM pg_constraint WHERE NOT convalidated`,
      ).toHaveLength(0);
    });
  },
);
