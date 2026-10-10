import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import {
  JOURNAL_GENESIS,
  payloadHash,
} from '../../src/server/erasure/journal-contract';
import {
  createPostgresJournal,
  initializeJournalStores,
} from '../../src/server/erasure/journal-postgres';
import { createRecoveryControl } from '../../src/server/erasure/recovery-control';
import { startPostgres } from '../lib/postgres-sandbox';
import { grantJournalStore, journalStorePermissions } from './permissions';

if (process.env.REQUIRE_ERASURE_TESTS === '1' && !process.env.PG_BIN)
  throw new Error('PG_BIN required for erasure tests');

describe.skipIf(!process.env.PG_BIN)(
  'co-located journal stores with restricted SQL roles',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    const admins: postgres.Sql[] = [];
    const clients: postgres.Sql[] = [];
    const names = ['journal', 'authority', 'receipts'] as const;
    let journal: ReturnType<typeof createPostgresJournal>;
    let control: ReturnType<typeof createRecoveryControl>;
    const journalId = randomUUID();
    let epoch = randomUUID();

    beforeAll(async () => {
      cluster = startPostgres();
      await cluster.sql`CREATE TABLE public.kept (id int PRIMARY KEY)`;
      await cluster.sql`INSERT INTO public.kept VALUES (1)`;
      await cluster.sql`REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`;
      for (const name of names) {
        const database = `store_${name}`;
        const role = `service_${name}`;
        await cluster.sql`CREATE ROLE ${cluster.sql(role)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`;
        await cluster.sql`CREATE DATABASE ${cluster.sql(database)} TEMPLATE template0`;
        const admin = postgres({ ...cluster.options, database });
        admins.push(admin);
        await admin.unsafe(
          readFileSync(new URL(`./${name}.sql`, import.meta.url), 'utf8'),
        );
        await grantJournalStore(admin, name, { database, role });
        clients.push(
          postgres({ ...cluster.options, database, username: role, max: 6 }),
        );
      }
      await initializeJournalStores(admins[0], admins[1], journalId, epoch);
      const pair = generateKeyPairSync('ed25519');
      const keys = {
        current: 'synthetic',
        signing: pair.privateKey,
        encryption: new Map([['synthetic', randomBytes(32)]]),
        verification: new Map([['synthetic', pair.publicKey]]),
      };
      journal = createPostgresJournal(
        clients[0],
        clients[1],
        clients[2],
        journalId,
        keys,
      );
      control = createRecoveryControl(clients[1], journal, keys);
    }, 30_000);
    afterAll(async () => {
      await Promise.all(
        [...admins, ...clients].map((sql) => sql.end({ timeout: 1 })),
      );
      await cluster?.stop();
    });

    test('store roles can connect only to their own database, never the application', async () => {
      for (const [index, name] of names.entries()) {
        const role = `service_${name}`;
        const [identity] = await clients[
          index
        ]`SELECT current_user AS role, current_database() AS database`;
        expect(identity).toEqual({ role, database: `store_${name}` });
        for (const database of [
          'postgres',
          ...names.map((value) => `store_${value}`),
        ]) {
          const [access] =
            await cluster.sql`SELECT has_database_privilege(${role}, ${database}, 'CONNECT') AS allowed`;
          expect(access.allowed).toBe(database === `store_${name}`);
        }
        await expect(
          clients[index]`SET ROLE postgres`.execute(),
        ).rejects.toThrow('permission denied');
        await expect(
          clients[index]`CREATE TABLE public.unwanted (id int)`.execute(),
        ).rejects.toThrow('permission denied');
      }
      expect(Array.from(await cluster.sql`SELECT id FROM public.kept`)).toEqual(
        [{ id: 1 }],
      );
    });

    test('only the explicit per-table permissions are available', async () => {
      for (const [index, name] of names.entries()) {
        const role = `service_${name}`;
        const permissions = journalStorePermissions[name];
        for (const [table, allowed] of Object.entries(permissions.tables))
          for (const privilege of [
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER',
          ]) {
            const [result] = await admins[
              index
            ]`SELECT has_table_privilege(${role}, ${`${permissions.schema}.${table}`}, ${privilege}) AS allowed`;
            expect(result.allowed).toBe(
              (allowed as readonly string[]).includes(privilege),
            );
          }
        await expect(
          clients[
            index
          ]`ALTER SCHEMA ${clients[index](permissions.schema)} RENAME TO unwanted`.execute(),
        ).rejects.toThrow();
      }
    });

    test('restricted clients publish, reconcile, seal and index receipts without schema ownership', async () => {
      const operationId = randomUUID();
      const payload = {
        version: 1 as const,
        action: 'revoke_passkey' as const,
        operationId,
        accountId: 'synthetic',
        credentialId: 'synthetic-key',
        acceptedAt: new Date().toISOString(),
      };
      await journal.registerReceipt({
        digest: 'a'.repeat(64),
        operationId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const entry = await journal.publish(epoch, payload);
      expect(entry.value.sequence).toBe('1');
      expect(
        (await journal.lookup(operationId, payloadHash(payload)))?.value.payload
          .operationId,
      ).toBe(operationId);
      expect((await journal.resolveReceipt('a'.repeat(64)))?.operationId).toBe(
        operationId,
      );
      expect((await journal.seal(epoch)).value.sealed).toBe(true);
      epoch = randomUUID();
      await journal.openEpoch((await journal.head()).value, epoch);
      expect((await journal.head()).value.epoch).toBe(epoch);
      await expect(
        clients[0]`DELETE FROM erasure_journal.entries`.execute(),
      ).rejects.toThrow('permission denied');
      await expect(
        clients[0]`UPDATE erasure_journal.entries SET key_id = 'wrong'`.execute(),
      ).rejects.toThrow('permission denied');
      await control.exclusive(async (lease) => {
        await lease.start({
          mode: 'bootstrap',
          id: randomUUID(),
          incarnation: randomUUID(),
          artifactHash: null,
          base: { journalId, sequence: '0', hash: JOURNAL_GENESIS },
          originRun: null,
          schemaHash: 'a'.repeat(64),
          catalogHash: 'b'.repeat(64),
          database: { database: 'postgres', oid: '1', cluster: 'synthetic' },
          retiredRoles: ['old_worker'],
          servingRole: 'new_worker',
          provisionalEpoch: randomUUID(),
          servingEpoch: randomUUID(),
          authEpoch: randomUUID(),
          generation: randomUUID(),
        });
        await lease.close();
      });
      expect((await control.current())?.admitted).toBe(false);
    });

    test('existing excess grants refuse the entire grant transaction instead of repairing the role', async () => {
      await cluster.sql`CREATE ROLE excess_store NOLOGIN NOINHERIT`;
      await admins[0]`GRANT UPDATE (body) ON erasure_journal.entries TO excess_store`;
      await expect(
        grantJournalStore(admins[0], 'journal', {
          database: 'store_journal',
          role: 'excess_store',
        }),
      ).rejects.toThrow('Unexpected journal role privileges');
      const [result] =
        await admins[0]`SELECT has_database_privilege('excess_store','store_journal','CONNECT') AS connect,
        has_table_privilege('excess_store','erasure_journal.head','SELECT') AS head,
        has_column_privilege('excess_store','erasure_journal.entries','body','UPDATE') AS original`;
      expect(result).toEqual({ connect: false, head: false, original: true });
    });

    test('wrong target and privileged or owning roles refuse grants without changing access', async () => {
      await expect(
        grantJournalStore(admins[0], 'journal', {
          database: 'wrong',
          role: 'service_journal',
        }),
      ).rejects.toThrow('identity refused');
      await expect(
        grantJournalStore(admins[0], 'journal', {
          database: 'store_journal',
          role: 'postgres',
        }),
      ).rejects.toThrow('identity refused');
      await cluster.sql`CREATE ROLE owned_store NOLOGIN NOINHERIT`;
      await admins[0]`CREATE SCHEMA owned AUTHORIZATION owned_store`;
      await expect(
        grantJournalStore(admins[0], 'journal', {
          database: 'store_journal',
          role: 'owned_store',
        }),
      ).rejects.toThrow('isolation refused');
      expect(
        (
          await admins[0]`SELECT has_schema_privilege('owned_store','erasure_journal','USAGE') AS allowed`
        )[0].allowed,
      ).toBe(false);
    });
  },
);
