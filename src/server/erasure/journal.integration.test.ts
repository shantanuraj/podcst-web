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
import {
  canonical,
  digest,
  type ErasurePayload,
  entryHash,
  JOURNAL_GENESIS,
  JOURNAL_PAGE_LIMIT,
  payloadHash,
  verifyReplay,
  verifyReplayPage,
  verifyValue,
} from './journal-contract';
import { createJournalClient, createJournalHandler } from './journal-http';
import {
  createPostgresJournal,
  initializeJournalStores,
  type JournalKeys,
} from './journal-postgres';
import { readVerifiedReplay } from './recovery-manifest';

if (process.env.REQUIRE_ERASURE_TESTS === '1' && !process.env.PG_BIN)
  throw new Error('PG_BIN required for erasure tests');

describe.skipIf(!process.env.PG_BIN)(
  'independent PostgreSQL journal service',
  () => {
    let journal: ReturnType<typeof startPostgres>;
    let authority: ReturnType<typeof startPostgres>;
    let receipts: ReturnType<typeof startPostgres>;
    let service: ReturnType<typeof createPostgresJournal>;
    let journalId: string;
    let epoch: string;
    let keys: JournalKeys;
    let time: number;
    const payload = (accountId = 'synthetic-account'): ErasurePayload => ({
      version: 1,
      operationId: randomUUID(),
      accountId,
      action: 'erase_account',
      acceptedAt: new Date(time).toISOString(),
    });
    const build = (ring = keys) =>
      createPostgresJournal(
        journal.sql,
        authority.sql,
        receipts.sql,
        journalId,
        ring,
        () => new Date(time),
      );
    const command = (name: string, args: string[]) => {
      const result = Bun.spawnSync(
        [join(process.env.PG_BIN ?? '', name), ...args],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    };
    beforeAll(() => {
      journal = startPostgres();
      authority = startPostgres();
      receipts = startPostgres();
    }, 30_000);
    beforeEach(async () => {
      time = Date.parse('2026-10-10T12:00:00Z');
      journalId = randomUUID();
      epoch = randomUUID();
      const pair = generateKeyPairSync('ed25519');
      keys = {
        current: 'synthetic-v1',
        signing: pair.privateKey,
        verification: new Map([['synthetic-v1', pair.publicKey]]),
        encryption: new Map([['synthetic-v1', randomBytes(32)]]),
      };
      for (const [cluster, kind, schema] of [
        [journal, 'journal', 'erasure_journal'],
        [authority, 'authority', 'erasure_authority'],
        [receipts, 'receipts', 'erasure_receipts'],
      ] as const) {
        await cluster.sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await cluster.sql.unsafe(
          readFileSync(
            new URL(
              `../../../scripts/erasure-journal/${kind}.sql`,
              import.meta.url,
            ),
            'utf8',
          ),
        );
      }
      await initializeJournalStores(
        journal.sql,
        authority.sql,
        journalId,
        epoch,
      );
      service = build();
    });
    afterAll(async () => {
      await journal?.sql.end({ timeout: 1 });
      await Promise.all([journal?.stop(), authority?.stop(), receipts?.stop()]);
    }, 30_000);

    test('concurrent exact publications commit once with contiguous independently witnessed sequences', async () => {
      const first = payload();
      const acks = await Promise.all(
        Array.from({ length: 8 }, () => service.publish(epoch, first)),
      );
      expect(new Set(acks.map(canonical)).size).toBe(1);
      expect(acks[0].value.sequence).toBe('1');
      await expect(
        service.publish(epoch, { ...first, accountId: 'different-account' }),
      ).rejects.toThrow();
      const second = await service.publish(epoch, payload());
      expect(second.value.sequence).toBe('2');
      expect(second.value.previousHash).toBe(entryHash(acks[0].value));
      const sealed = await service.seal(epoch);
      const { entries } = await service.readRange(
        { journalId, sequence: '0', hash: JOURNAL_GENESIS },
        sealed.value,
      );
      expect(
        verifyReplay(
          entries,
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          sealed,
          keys.verification,
        ).sequence,
      ).toBe('2');
      expect(
        await authority.sql`SELECT sequence::text FROM erasure_authority.head`,
      ).toMatchObject([{ sequence: '2' }]);
      const raw = JSON.stringify(
        await journal.sql`SELECT * FROM erasure_journal.entries`,
      );
      expect(raw).not.toContain(first.accountId);
      expect(raw).not.toContain('erase_account');
    });

    test('a dropped HTTP acknowledgement reconciles through lookup and never republishes a different operation', async () => {
      const tokens = new Map([
        ['runtime', randomBytes(32).toString('base64url')],
        ['recovery', randomBytes(32).toString('base64url')],
        ['admission', randomBytes(32).toString('base64url')],
      ] as const);
      const handler = createJournalHandler(service, tokens);
      let lose = true;
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const response = await handler(request);
          if (
            new URL(request.url).pathname === '/publish' &&
            lose &&
            response.ok
          ) {
            lose = false;
            return new Response(null, { status: 503 });
          }
          return response;
        },
      });
      try {
        const client = createJournalClient({
          url: server.url.href,
          token: tokens.get('runtime') ?? '',
          journalId,
          keys: keys.verification,
          allowLoopback: true,
        });
        const event = payload();
        await expect(client.publish(epoch, event)).rejects.toThrow();
        const ack = await client.lookup(event.operationId, payloadHash(event));
        if (!ack) throw new Error('Missing durable acknowledgement');
        expect(ack.value.sequence).toBe('1');
        expect(await client.publish(epoch, event)).toEqual(ack);
        expect(
          await journal.sql`SELECT 1 FROM erasure_journal.entries`,
        ).toHaveLength(1);
        for (const path of ['/head', '/seal', '/range', '/epochs/open']) {
          const response = await fetch(new URL(path, server.url), {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.get('runtime')}` },
            body: '{}',
          });
          expect(response.status).toBe(403);
          expect(response.headers.get('cache-control')).toBe(
            'private, no-store',
          );
        }
        const wrong = await fetch(new URL('/publish', server.url), {
          method: 'POST',
          body: '{}',
        });
        expect(wrong.status).toBe(403);
      } finally {
        await server.stop(true);
      }
    });

    test('acknowledged ciphertext survives an immediate PostgreSQL crash and adapter restart', async () => {
      const event = payload();
      const ack = await service.publish(epoch, event);
      await journal.sql.end();
      command('pg_ctl', [
        '-D',
        join(journal.directory, 'data'),
        '-m',
        'immediate',
        '-w',
        'stop',
      ]);
      command('pg_ctl', [
        '-D',
        join(journal.directory, 'data'),
        '-l',
        join(journal.directory, 'server.log'),
        '-o',
        `-k ${journal.directory} -p ${journal.options.port} -h ''`,
        '-w',
        'start',
      ]);
      journal.sql = postgres(journal.options);
      service = build();
      expect(
        await service.lookup(event.operationId, payloadHash(event)),
      ).toEqual(ack);
      expect((await service.head()).value.sequence).toBe('1');
    });

    test('journal rollback behind the independent authority refuses lookup, append and recovery', async () => {
      const checkpoint = join(journal.directory, 'journal.dump');
      const connection = [
        '-h',
        journal.directory,
        '-p',
        String(journal.options.port),
        '-U',
        'postgres',
        '-d',
        'postgres',
      ];
      command('pg_dump', [
        ...connection,
        '-Fc',
        '-n',
        'erasure_journal',
        '-f',
        checkpoint,
      ]);
      const event = payload();
      await service.publish(epoch, event);
      await journal.sql`DROP SCHEMA erasure_journal CASCADE`;
      command('pg_restore', [
        ...connection,
        '--exit-on-error',
        '--single-transaction',
        checkpoint,
      ]);
      await expect(
        service.lookup(event.operationId, payloadHash(event)),
      ).rejects.toThrow();
      await expect(service.publish(epoch, event)).rejects.toThrow();
      await expect(service.head()).rejects.toThrow();
      expect(
        await authority.sql`SELECT sequence::text FROM erasure_authority.head`,
      ).toMatchObject([{ sequence: '1' }]);
    });

    test('sealed epochs refuse stale writers and authentic stale heads after opening a new epoch', async () => {
      await service.publish(epoch, payload());
      const sealed = await service.seal(epoch);
      await expect(service.publish(epoch, payload())).rejects.toThrow();
      const next = randomUUID();
      await service.openEpoch(sealed.value, next);
      await expect(service.publish(epoch, payload())).rejects.toThrow();
      await expect(
        service.readRange(
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          sealed.value,
        ),
      ).rejects.toThrow();
      await service.publish(next, payload());
      const current = await service.seal(next);
      const first = (
        await journal.sql`SELECT operation_id FROM erasure_journal.entries WHERE sequence = 1`
      )[0];
      expect(first).toBeDefined();
      const all = await service.readRange(
        { journalId, sequence: '0', hash: JOURNAL_GENESIS },
        current.value,
      );
      const base = {
        journalId,
        sequence: '1',
        hash: entryHash(all.entries[0].value),
      };
      const tail = await service.readRange(base, current.value);
      expect(tail.entries).toHaveLength(1);
      expect(tail.entries[0].value.sequence).toBe('2');
      expect(
        verifyReplay(tail.entries, base, tail.head, keys.verification).sequence,
      ).toBe('2');
    });

    test('expiry uses an accelerated clock and never removes suppression or renews receipts', async () => {
      const event = payload();
      const token = randomBytes(32).toString('base64url');
      const receipt = {
        digest: digest(token),
        operationId: event.operationId,
        expiresAt: new Date(time + 7 * 86_400_000).toISOString(),
      };
      await service.registerReceipt(receipt);
      await service.registerReceipt(receipt);
      expect((await service.resolveReceipt(receipt.digest))?.entry).toBeNull();
      await expect(
        service.registerReceipt({
          ...receipt,
          expiresAt: new Date(time + 6 * 86_400_000).toISOString(),
        }),
      ).rejects.toThrow();
      const ack = await service.publish(epoch, event);
      const restoredReceipt =
        await receipts.sql`SELECT * FROM erasure_receipts.receipts`;
      expect((await service.resolveReceipt(receipt.digest))?.entry).toEqual(
        ack,
      );
      time += 7 * 86_400_000;
      expect(await service.resolveReceipt(receipt.digest)).toBeNull();
      await service.purgeReceipts();
      expect(
        await receipts.sql`SELECT 1 FROM erasure_receipts.receipts`,
      ).toHaveLength(0);
      await receipts.sql`INSERT INTO erasure_receipts.receipts ${receipts.sql(restoredReceipt[0])}`;
      expect(await service.resolveReceipt(receipt.digest)).toBeNull();
      await expect(
        service.registerReceipt({
          ...receipt,
          expiresAt: new Date(time + 7 * 86_400_000).toISOString(),
        }),
      ).rejects.toThrow();
      expect(
        await service.lookup(event.operationId, payloadHash(event)),
      ).toEqual(ack);
      expect(
        JSON.stringify(
          await journal.sql`SELECT * FROM erasure_journal.entries`,
        ),
      ).not.toContain(receipt.digest);
    });

    test('key rotation retains old decryption/verification requirements and refuses missing or wrong keys', async () => {
      const first = payload();
      const ack = await service.publish(epoch, first);
      const pair = generateKeyPairSync('ed25519');
      const rotated: JournalKeys = {
        current: 'synthetic-v2',
        signing: pair.privateKey,
        verification: new Map([
          ...keys.verification,
          ['synthetic-v2', pair.publicKey],
        ]),
        encryption: new Map([
          ...keys.encryption,
          ['synthetic-v2', randomBytes(32)],
        ]),
      };
      const next = build(rotated);
      await next.publish(epoch, payload());
      expect(await next.lookup(first.operationId, payloadHash(first))).toEqual(
        ack,
      );
      const missing = build({
        ...rotated,
        encryption: new Map([
          ['synthetic-v2', rotated.encryption.get('synthetic-v2') as Buffer],
        ]),
      });
      await expect(
        missing.lookup(first.operationId, payloadHash(first)),
      ).rejects.toThrow();
      const wrong = build({
        ...rotated,
        encryption: new Map([
          ...rotated.encryption,
          ['synthetic-v1', randomBytes(32)],
        ]),
      });
      await expect(
        wrong.lookup(first.operationId, payloadHash(first)),
      ).rejects.toThrow();
      expect(() => verifyValue(ack, new Map())).toThrow();
    });

    test('corrupt ciphertext, omitted ranges and mismatched signing keys refuse recovery', async () => {
      const event = payload();
      const ack = await service.publish(epoch, event);
      const sealed = await service.seal(epoch);
      expect(() =>
        verifyReplay(
          [],
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          sealed,
          keys.verification,
        ),
      ).toThrow();
      const other = generateKeyPairSync('ed25519');
      expect(() => build({ ...keys, signing: other.privateKey })).toThrow();
      await journal.sql`UPDATE erasure_journal.entries SET body = set_byte(body, 30, get_byte(body, 30) # 1)`;
      await expect(
        service.lookup(event.operationId, payloadHash(event)),
      ).rejects.toThrow();
      await expect(
        service.readRange(
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          sealed.value,
        ),
      ).rejects.toThrow();
      expect(ack.value.payload).toEqual(event);
    });

    test('recovery pages and authority catch-up remain bounded without omitting a signed tail', async () => {
      for (let i = 0; i < JOURNAL_PAGE_LIMIT + 3; i++)
        await service.publish(epoch, payload());
      const sealed = await service.seal(epoch);
      const first = await service.readRange(
        { journalId, sequence: '0', hash: JOURNAL_GENESIS },
        sealed.value,
      );
      expect(first.entries).toHaveLength(JOURNAL_PAGE_LIMIT);
      expect(
        verifyReplayPage(
          first.entries,
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          first.head,
          keys.verification,
        ).done,
      ).toBe(false);
      expect(() =>
        verifyReplay(
          first.entries,
          { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          first.head,
          keys.verification,
        ),
      ).toThrow();
      const sizes: number[] = [];
      for await (const page of readVerifiedReplay(
        service,
        { journalId, sequence: '0', hash: JOURNAL_GENESIS },
        sealed,
        keys.verification,
      ))
        sizes.push(page.entries.length);
      expect(sizes).toEqual([JOURNAL_PAGE_LIMIT, 3]);
      await authority.sql`UPDATE erasure_authority.head SET sequence = 0, revision = 0, hash = ${JOURNAL_GENESIS}, sealed = false`;
      expect((await build().head()).value).toEqual(sealed.value);
      await journal.sql`DELETE FROM erasure_journal.entries WHERE sequence = ${String(JOURNAL_PAGE_LIMIT + 1)}::bigint`;
      const cursor = verifyReplayPage(
        first.entries,
        { journalId, sequence: '0', hash: JOURNAL_GENESIS },
        first.head,
        keys.verification,
      ).cursor;
      await expect(service.readRange(cursor, sealed.value)).rejects.toThrow();
    }, 30_000);

    test('recovery HTTP requires an explicit bounded page size and never exposes it to runtime tokens', async () => {
      for (let i = 0; i < 3; i++) await service.publish(epoch, payload());
      const head = await service.seal(epoch);
      const tokens = new Map([
        ['runtime', randomBytes(32).toString('base64url')],
        ['recovery', randomBytes(32).toString('base64url')],
        ['admission', randomBytes(32).toString('base64url')],
      ] as const);
      const handler = createJournalHandler(service, tokens);
      const request = (role: 'runtime' | 'recovery', limit?: number) =>
        new Request('http://127.0.0.1/range', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.get(role)}` },
          body: JSON.stringify({
            base: { journalId, sequence: '0', hash: JOURNAL_GENESIS },
            head: head.value,
            ...(limit === undefined ? {} : { limit }),
          }),
        });
      const page = await handler(request('recovery', 2));
      expect(page.status).toBe(200);
      expect((await page.json()).entries).toHaveLength(2);
      for (const limit of [undefined, 0, -1, 1.5, JOURNAL_PAGE_LIMIT + 1])
        expect((await handler(request('recovery', limit))).status).toBe(400);
      expect((await handler(request('runtime', 2))).status).toBe(403);
    });

    test('publication committed before authority outage is pending until reconciliation advances the witness', async () => {
      const event = payload();
      await authority.sql.unsafe(`
        CREATE FUNCTION erasure_authority.refuse() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'synthetic authority outage'; END $$;
        CREATE TRIGGER refuse BEFORE UPDATE ON erasure_authority.head
        FOR EACH ROW EXECUTE FUNCTION erasure_authority.refuse();
      `);
      await expect(service.publish(epoch, event)).rejects.toThrow(
        'synthetic authority outage',
      );
      expect(
        await journal.sql`SELECT sequence::text FROM erasure_journal.head`,
      ).toMatchObject([{ sequence: '1' }]);
      expect(
        await authority.sql`SELECT sequence::text FROM erasure_authority.head`,
      ).toMatchObject([{ sequence: '0' }]);
      await authority.sql`DROP TRIGGER refuse ON erasure_authority.head`;
      const ack = await build().lookup(event.operationId, payloadHash(event));
      expect(ack?.value.payload).toEqual(event);
      expect((await service.head()).value.sequence).toBe('1');
      await authority.sql`DELETE FROM erasure_authority.head`;
      await expect(service.publish(epoch, payload())).rejects.toThrow();
      await expect(service.resolveReceipt(digest('unknown'))).rejects.toThrow();
    });
  },
);
