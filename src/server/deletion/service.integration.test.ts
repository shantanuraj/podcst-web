import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { createEmailService } from '../auth/email-service';
import { reviewCodeDigest } from '../auth/review-credential';
import { insertSession } from '../auth/session-record';
import { deletionHandlers } from './http';
import type { DeletionRecord } from './record';
import { createDeletionService, eraseAccount } from './service';

describe.skipIf(!process.env.PG_BIN)(
  'account deletion in isolated PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let service: ReturnType<typeof createDeletionService>;
    let code: string;
    let time: Date;
    let failPublication: boolean;
    let lostAcknowledgement: boolean;
    let journal: Map<string, DeletionRecord>;
    const owner = { id: 'session-a', userId: 'a', email: 'a@example.test' };
    const other = { id: 'session-b', userId: 'b', email: 'b@example.test' };

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 5 });
      await createSchemaFixture(sql);
    }, 30_000);
    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });
    beforeEach(async () => {
      await sql`TRUNCATE users, authors, account_erasure_intents, account_deletion_receipts, email_verifications CASCADE`;
      await sql`INSERT INTO users (id, email) VALUES ('a', 'a@example.test'), ('b', 'b@example.test')`;
      await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES ('session-a', 'a', '2031-01-01'), ('session-b', 'b', '2031-01-01')`;
      await sql`INSERT INTO passkeys (id, user_id, credential_id, public_key) VALUES ('a-key', 'a', 'a-credential', decode('01','hex'))`;
      await sql`INSERT INTO authors (id, name) VALUES (1, 'Public'), (2, 'Private')`;
      await sql`INSERT INTO podcasts (id, author_id, feed_url, title, cover, owner_user_id) VALUES (1, 1, 'https://example.test/public', 'Public', '', NULL), (2, 2, 'https://example.test/private', 'Private', '', 'a')`;
      await sql`INSERT INTO account_preferences (user_id, speed, volume_boost, trim_silence) VALUES ('a', 1.5, true, false), ('b', 1, false, false)`;
      await sql`INSERT INTO subscriptions (user_id, podcast_id, revision) VALUES ('a', 1, 1), ('a', 2, 2), ('b', 1, 1)`;
      await sql`INSERT INTO episodes (id, podcast_id, guid, published) VALUES (1, 1, 'public', now()), (2, 2, 'private', now())`;
      await sql`INSERT INTO episode_lists (id, user_id, kind) VALUES ('00000000-0000-4000-8000-000000000001', 'a', 'starred'), ('00000000-0000-4000-8000-000000000002', 'b', 'starred')`;
      await sql`INSERT INTO episode_list_items (list_id, episode_id) VALUES ('00000000-0000-4000-8000-000000000001', 2), ('00000000-0000-4000-8000-000000000002', 1)`;
      await sql`INSERT INTO playback_progress (user_id, episode_id, position, revision) VALUES ('a', 2, 10, 1), ('b', 1, 20, 1)`;
      time = new Date();
      failPublication = false;
      lostAcknowledgement = false;
      journal = new Map();
      service = createDeletionService(sql, {
        secret: 's'.repeat(64),
        now: () => time,
        deliver: async (_email, value) => {
          code = value;
        },
        publish: async (record) => {
          if (failPublication) throw new Error('journal unavailable');
          const existing = journal.get(record.operationId);
          if (existing) expect(existing).toEqual(record);
          journal.set(record.operationId, record);
          if (lostAcknowledgement) throw new Error('acknowledgement lost');
          return { signature: 'a'.repeat(64) };
        },
      });
    });

    test('fresh account/session-bound proof deletes canonical state and preserves other accounts and public content', async () => {
      const preparation = await service.prepare(owner, 'a');
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'unknown',
      });
      await expect(
        service.accept(other, preparation.operationId, code, true),
      ).rejects.toThrow('Invalid or expired');
      expect((await sql`SELECT id FROM users`).length).toBe(2);
      expect(
        await service.accept(owner, preparation.operationId, code, true),
      ).toEqual({ operationId: preparation.operationId, status: 'completed' });
      expect([...journal.values()]).toEqual([
        {
          operationId: preparation.operationId,
          accountId: 'a',
          acceptedAt: time.toISOString(),
        },
      ]);
      for (const table of [
        'sessions',
        'passkeys',
        'account_preferences',
        'subscriptions',
        'episode_lists',
        'playback_progress',
      ])
        expect(
          (await sql`SELECT * FROM ${sql(table)} WHERE user_id = 'a'`).length,
        ).toBe(0);
      expect(
        (await sql`SELECT id FROM users ORDER BY id`).map((row) => row.id),
      ).toEqual(['b']);
      expect(
        (await sql`SELECT id FROM podcasts ORDER BY id`).map((row) =>
          String(row.id),
        ),
      ).toEqual(['1']);
      expect(
        (await sql`SELECT id FROM authors ORDER BY id`).map((row) => row.id),
      ).toEqual([1]);
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'completed',
      });
      expect(await sql`SELECT episode_id FROM episode_list_items`).toHaveLength(
        1,
      );
      expect(
        await sql`SELECT * FROM playback_progress WHERE user_id = 'b'`,
      ).toHaveLength(1);
    });

    test('proof requires explicit confirmation and has five attempts and a five-minute lifetime', async () => {
      let preparation = await service.prepare(owner, 'a');
      await expect(
        service.accept(owner, preparation.operationId, code, false),
      ).rejects.toThrow('Invalid deletion');
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(
          service.accept(
            owner,
            preparation.operationId,
            code === '000000' ? '111111' : '000000',
            true,
          ),
        ).rejects.toThrow('Invalid or expired');
      await expect(
        service.accept(owner, preparation.operationId, code, true),
      ).rejects.toThrow('Invalid or expired');
      preparation = await service.prepare(owner, 'a');
      time = new Date(time.getTime() + 5 * 60_000);
      await expect(
        service.accept(owner, preparation.operationId, code, true),
      ).rejects.toThrow('Invalid or expired');
      expect(journal.size).toBe(0);
      expect((await sql`SELECT id FROM users WHERE id = 'a'`).length).toBe(1);
    });

    test('HTTP deletion reconciles without authentication or cookie mutation and refuses foreign origins', async () => {
      let sessionReads = 0;
      const limited: string[] = [];
      const handlers = deletionHandlers({
        service: () => service,
        session: async () => {
          sessionReads++;
          return owner;
        },
        limit: async (_request, kind) => {
          limited.push(kind);
        },
      });
      const request = (
        body: unknown,
        method = 'POST',
        headers: Record<string, string> = {},
      ) =>
        new Request('https://podcst.example/api/account/deletion', {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-podcst-client': 'native',
            ...headers,
          },
          body: JSON.stringify(body),
        });
      const refused = await handlers.prepare(
        request({ accountId: 'a' }, 'POST', {
          Origin: 'https://foreign.example',
        }),
      );
      expect(refused.status).toBe(403);
      expect(sessionReads).toBe(0);
      const prepared = await handlers.prepare(request({ accountId: 'a' }));
      const preparation = await prepared.json();
      failPublication = true;
      const submitted = await handlers.submit(
        request(
          { operationId: preparation.operationId, code, confirmed: true },
          'DELETE',
        ),
      );
      expect(submitted.status).toBe(202);
      expect(submitted.headers.get('Retry-After')).toBe('10');
      failPublication = false;
      const status = await handlers.status(
        request({ receipt: preparation.receipt }),
      );
      expect(await status.json()).toEqual({ status: 'completed' });
      expect(sessionReads).toBe(2);
      expect(limited).toEqual(['send', 'verify', 'deletion-status']);
      for (const response of [refused, prepared, submitted, status]) {
        expect(response.headers.get('Cache-Control')).toContain('no-store');
        expect(response.headers.has('Set-Cookie')).toBe(false);
      }
    });

    test('refuses changed account and changed session without consuming the real proof', async () => {
      await expect(service.prepare(owner, 'b')).rejects.toThrow(
        'Account changed',
      );
      const preparation = await service.prepare(owner, 'a');
      const session = await sql.begin((tx) => insertSession(tx, 'a'));
      await expect(
        service.accept(
          { ...owner, id: session.id },
          preparation.operationId,
          code,
          true,
        ),
      ).rejects.toThrow('Invalid or expired');
      expect(
        (await service.accept(owner, preparation.operationId, code, true))
          .status,
      ).toBe('completed');
    });

    test('publication outage fences authentication and keeps the receipt pending until publication succeeds', async () => {
      failPublication = true;
      const preparation = await service.prepare(owner, 'a');
      expect(
        (await service.accept(owner, preparation.operationId, code, true))
          .status,
      ).toBe('pending');
      expect(
        (await sql`SELECT id FROM sessions WHERE user_id = 'a'`).length,
      ).toBe(0);
      await expect(sql.begin((tx) => insertSession(tx, 'a'))).rejects.toThrow(
        'Authentication required',
      );
      await expect(service.prepare(owner, 'a')).rejects.toThrow(
        'Authentication required',
      );
      expect((await sql`SELECT id FROM users WHERE id = 'a'`).length).toBe(1);
      expect(journal.size).toBe(0);
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'pending',
      });
      expect((await service.reconcilePending()).pending).toBe(1);
      failPublication = false;
      expect((await service.reconcilePending()).pending).toBe(0);
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'completed',
      });
    });

    test('accepted deletion revokes reusable reviewer login without affecting another reviewer', async () => {
      const secret = 's'.repeat(64);
      const reviewCode = '654321';
      for (const [store, account] of [
        ['apple', owner],
        ['google', other],
      ] as const) {
        await sql`INSERT INTO review_accounts (store, purpose, user_id, code_digest, operation_id, operation_digest, operation_kind, submission)
          VALUES (${store}, 'review', ${account.userId}, ${reviewCodeDigest(secret, store, account.email, reviewCode)}, ${crypto.randomUUID()}, ${'0'.repeat(64)}, 'create', 'synthetic deletion integration')`;
      }
      const login = createEmailService(sql, secret, async () => {
        throw new Error('Unexpected delivery');
      });
      expect(await login.login(owner.email, reviewCode)).not.toBeNull();
      const preparation = await service.prepare(owner, owner.userId);
      failPublication = true;
      expect(
        (await service.accept(owner, preparation.operationId, code, true))
          .status,
      ).toBe('pending');
      await expect(login.login(owner.email, reviewCode)).rejects.toThrow(
        'Authentication required',
      );
      expect(await login.login(other.email, reviewCode)).not.toBeNull();
      failPublication = false;
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'completed',
      });
      expect(await login.login(owner.email, reviewCode)).toBeNull();
      expect(
        await sql`SELECT * FROM review_accounts WHERE user_id = ${owner.userId}`,
      ).toHaveLength(0);
      expect(await login.login(other.email, reviewCode)).not.toBeNull();
    });

    test('lost publication acknowledgement reconciles idempotently; expired receipts never become success', async () => {
      lostAcknowledgement = true;
      const preparation = await service.prepare(owner, 'a');
      expect(
        (await service.accept(owner, preparation.operationId, code, true))
          .status,
      ).toBe('pending');
      expect(journal.size).toBe(1);
      lostAcknowledgement = false;
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'completed',
      });
      expect(journal.size).toBe(1);
      time = new Date(time.getTime() + 7 * 86400_000);
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'unknown',
      });
      await service.reconcilePending();
      expect((await sql`SELECT * FROM account_deletion_receipts`).length).toBe(
        0,
      );
    });

    test('database commit failure remains pending after independent publication and can be retried', async () => {
      const preparation = await service.prepare(owner, 'a');
      await sql`CREATE FUNCTION refuse_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`;
      await sql`CREATE TRIGGER refuse_test_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION refuse_test_delete()`;
      try {
        expect(
          (await service.accept(owner, preparation.operationId, code, true))
            .status,
        ).toBe('pending');
        expect(journal.size).toBe(1);
        expect((await sql`SELECT id FROM users WHERE id = 'a'`).length).toBe(1);
      } finally {
        await sql`DROP TRIGGER refuse_test_delete ON users`;
        await sql`DROP FUNCTION refuse_test_delete()`;
      }
      expect(await service.status(preparation.receipt)).toEqual({
        status: 'completed',
      });
    });

    test('replay suppresses a restored account; later registration has a different identity', async () => {
      const preparation = await service.prepare(owner, 'a');
      await service.accept(owner, preparation.operationId, code, true);
      await sql`INSERT INTO users (id, email) VALUES ('a', 'a@example.test')`;
      for (const record of journal.values())
        await sql.begin((tx) => eraseAccount(tx, record.accountId));
      let loginCode = '';
      const email = createEmailService(
        sql,
        's'.repeat(64),
        async (_email, value) => {
          loginCode = value;
        },
      );
      await email.send(owner.email);
      const session = await email.login(owner.email, loginCode);
      if (!session) throw new Error('Expected a new session');
      const [newAccount] =
        await sql`SELECT user_id FROM sessions WHERE id = ${session.id}`;
      expect(newAccount.user_id).not.toBe('a');
    });

    test('unexpected foreign list references refuse deletion without disabling deferred constraints', async () => {
      await sql`INSERT INTO episode_list_items (list_id, episode_id) VALUES ('00000000-0000-4000-8000-000000000002', 2)`;
      const preparation = await service.prepare(owner, 'a');
      expect(
        (await service.accept(owner, preparation.operationId, code, true))
          .status,
      ).toBe('pending');
      expect(journal.size).toBe(1);
      expect(await sql`SELECT id FROM users WHERE id = 'a'`).toHaveLength(1);
      expect(await sql`SELECT * FROM episode_list_items`).toHaveLength(3);
    });

    test('reissuing proof serializes against an old submission and cannot cancel accepted deletion', async () => {
      const preparation = await service.prepare(owner, 'a');
      const oldCode = code;
      const [submitted, renewed] = await Promise.allSettled([
        service.accept(owner, preparation.operationId, oldCode, true),
        service.prepare(owner, 'a'),
      ]);
      expect(
        [submitted, renewed].filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      if (renewed.status === 'fulfilled') {
        await expect(
          service.accept(owner, preparation.operationId, oldCode, true),
        ).rejects.toThrow('Invalid or expired');
        expect(
          (await service.accept(owner, renewed.value.operationId, code, true))
            .status,
        ).toBe('completed');
      }
      expect(await service.reconcilePending()).toMatchObject({ pending: 0 });
      expect(journal.size).toBe(1);
    });

    test('concurrent receipt checks cannot turn a completed operation into pending', async () => {
      const preparation = await service.prepare(owner, 'a');
      failPublication = true;
      await service.accept(owner, preparation.operationId, code, true);
      failPublication = false;
      const results = await Promise.all([
        service.status(preparation.receipt),
        service.status(preparation.receipt),
      ]);
      expect(results).toEqual([
        { status: 'completed' },
        { status: 'completed' },
      ]);
      expect(journal.size).toBe(1);
    });
  },
);
