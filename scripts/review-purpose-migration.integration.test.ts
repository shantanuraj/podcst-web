import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createEmailService } from '../src/server/auth/email-service';
import { reviewCodeDigest } from '../src/server/auth/review-credential';
import { startPostgres } from './lib/postgres-sandbox';
import { loadMigrations, migrate } from './migrations';

test.skipIf(!process.env.PG_BIN)(
  'purpose migration preserves reviewer credentials, state and runtime privileges',
  async () => {
    const cluster = startPostgres();
    const sql = cluster.sql;
    const secret = 'synthetic-migration-secret'.repeat(3);
    try {
      const migrations = loadMigrations();
      await migrate(
        sql,
        migrations.filter(({ name }) => name <= '0025-review-accounts.sql'),
      );
      await sql`CREATE ROLE purpose_runtime`;
      await sql`GRANT SELECT ON review_accounts TO purpose_runtime`;
      await sql`INSERT INTO users (id, email) VALUES ('reviewer', 'reviewer@example.invalid')`;
      await sql`INSERT INTO review_accounts (store, user_id, code_digest, operation_id, operation_digest, operation_kind, submission)
      VALUES ('apple', 'reviewer', ${reviewCodeDigest(secret, 'apple', 'reviewer@example.invalid', '012345')}, ${randomUUID()}, ${'a'.repeat(64)}, 'create', 'migration-rehearsal')`;
      const [before] =
        await sql`SELECT to_jsonb(r) AS row FROM review_accounts r`;
      await migrate(sql, migrations);
      const [after] =
        await sql`SELECT to_jsonb(r) AS row FROM review_accounts r`;
      expect(after.row).toEqual({ ...before.row, purpose: 'review' });
      const [access] =
        await sql`SELECT has_table_privilege('purpose_runtime', 'review_accounts', 'SELECT') AS read,
      has_table_privilege('purpose_runtime', 'review_accounts', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write`;
      expect(access).toEqual({ read: true, write: false });
      const auth = createEmailService(sql, secret, async () => {});
      expect(
        await auth.login('reviewer@example.invalid', '012345'),
      ).not.toBeNull();
      await expect(
        sql`UPDATE review_accounts SET purpose = 'unknown'`.execute(),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        sql`UPDATE review_accounts SET purpose = DEFAULT`.execute(),
      ).rejects.toMatchObject({ code: '23502' });
    } finally {
      await cluster.stop();
    }
  },
  30_000,
);
