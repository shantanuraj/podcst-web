import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPostgres } from '../lib/postgres-sandbox';
import { createSchemaFixture } from '../lib/schema-fixture';
import { deletionLog } from './store';

test.skipIf(!process.env.PG_BIN)(
  'replay removes recorded accounts and all credential types while preserving other account state',
  async () => {
    const cluster = startPostgres({ tcp: true });
    const directory = await mkdtemp(join(tmpdir(), 'podcst-replay-'));
    const secret = 'synthetic-journal-secret'.repeat(3);
    const sql = cluster.sql;
    try {
      await createSchemaFixture(sql);
      await sql`INSERT INTO users (id, email) VALUES ('a', 'a@example.invalid'), ('b', 'b@example.invalid')`;
      await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES ('session-b', 'b', now() + interval '1 day')`;
      await sql`INSERT INTO passkeys (id, user_id, credential_id, public_key) VALUES ('key-b', 'b', 'credential-b', decode('01', 'hex'))`;
      await sql`INSERT INTO review_accounts (store, purpose, user_id, code_digest, operation_id, operation_digest, operation_kind, submission)
      VALUES ('apple', 'review', 'b', ${'0'.repeat(64)}, ${crypto.randomUUID()}, ${'0'.repeat(64)}, 'create', 'synthetic')`;
      await sql`INSERT INTO account_preferences (user_id, speed, volume_boost, trim_silence) VALUES ('b', 1.5, true, false)`;
      const [before] = await sql`SELECT * FROM state_generation`;
      await deletionLog(directory, secret).append({
        operationId: crypto.randomUUID(),
        accountId: 'a',
        acceptedAt: new Date().toISOString(),
      });
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          new URL('./replay.ts', import.meta.url).pathname,
          '--closed-restore-target',
        ],
        {
          cwd: new URL('../..', import.meta.url).pathname,
          env: {
            DATABASE_URL: cluster.url,
            ACCOUNT_DELETION_JOURNAL_DIRECTORY: directory,
            ACCOUNT_DELETION_JOURNAL_SECRET: secret,
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [exit, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exit, output + error).toBe(0);
      expect((await sql`SELECT id FROM users`).map((row) => row.id)).toEqual([
        'b',
      ]);
      expect(
        await sql`SELECT * FROM account_preferences WHERE user_id = 'b'`,
      ).toHaveLength(1);
      for (const table of ['sessions', 'passkeys', 'review_accounts'])
        expect(await sql`SELECT * FROM ${sql(table)}`).toHaveLength(0);
      const [after] = await sql`SELECT * FROM state_generation`;
      expect(after.generation).not.toBe(before.generation);
      expect(after.legacy_generation).toBe(before.legacy_generation);
    } finally {
      await cluster.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
