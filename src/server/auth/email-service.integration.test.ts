import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { loadMigrations } from '../../../scripts/migrations';
import { createEmailService } from './email-service';

const secret = 'synthetic-auth-key'.repeat(4);

describe.skipIf(!process.env.PG_BIN)(
  'email codes on disposable PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    const delivered = new Map<string, string>();
    const codeFor = (email: string) => {
      const code = delivered.get(email);
      if (!code) throw new Error('No synthetic code delivered');
      return code;
    };
    let service: ReturnType<typeof createEmailService>;

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 10 });
      await createSchemaFixture(sql);
      service = createEmailService(sql, secret, async (email, code) => {
        delivered.set(email, code);
      });
    }, 30_000);

    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    test('populated upgrades invalidate old codes without revoking sessions and roll back atomically', async () => {
      const upgrade = startPostgres();
      try {
        const migrations = loadMigrations();
        const security = migrations.find(
          (migration) => migration.name === '0009-email-code-security.sql',
        );
        if (!security) throw new Error('Security migration missing');
        for (const migration of migrations.filter(
          (migration) => migration.name < security.name,
        ))
          await upgrade.sql.unsafe(migration.source);
        await upgrade.sql`INSERT INTO users (id, email) VALUES ('existing', 'existing@example.invalid')`;
        await upgrade.sql`INSERT INTO sessions (id, user_id, expires_at) VALUES ('existing', 'existing', now() + interval '1 day')`;
        await upgrade.sql`INSERT INTO email_verifications (id, email, code, expires_at) VALUES ('old', 'existing@example.invalid', '123456', now() + interval '1 hour')`;
        await expect(
          upgrade.sql.begin(async (tx) => {
            await tx.unsafe(security.source);
            throw new Error('synthetic rollback');
          }),
        ).rejects.toThrow('synthetic rollback');
        expect(
          Array.from(await upgrade.sql`SELECT code FROM email_verifications`),
        ).toEqual([{ code: '123456' }]);
        await upgrade.sql.begin((tx) => tx.unsafe(security.source));
        expect(
          await upgrade.sql`SELECT * FROM email_verifications`,
        ).toHaveLength(0);
        expect(Array.from(await upgrade.sql`SELECT id FROM users`)).toEqual([
          { id: 'existing' },
        ]);
        expect(Array.from(await upgrade.sql`SELECT id FROM sessions`)).toEqual([
          { id: 'existing' },
        ]);
      } finally {
        await upgrade.stop();
      }
    });

    test('stores a protected, per-issuance digest rather than the code', async () => {
      const email = 'digest@example.invalid';
      await service.send(email);
      const [row] =
        await sql`SELECT * FROM email_verifications WHERE email = ${email}`;
      expect(delivered.get(email)).toMatch(/^\d{6}$/);
      expect(row.code_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.code).toBeUndefined();
      expect(row.code_digest).not.toBe(delivered.get(email));
      expect(row.ready).toBe(true);
      expect(row.attempts).toBe(0);
      await service.send(email);
      const [replacement] =
        await sql`SELECT * FROM email_verifications WHERE email = ${email}`;
      expect(replacement.id).not.toBe(row.id);
      expect(replacement.code_digest).not.toBe(row.code_digest);
    });

    test('concurrent redemption creates exactly one user and session', async () => {
      const email = 'race@example.invalid';
      await service.send(email);
      const results = await Promise.all(
        Array.from({ length: 12 }, () => service.login(email, codeFor(email))),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const users = await sql`SELECT id FROM users WHERE email = ${email}`;
      expect(users).toHaveLength(1);
      expect(
        await sql`SELECT id FROM sessions WHERE user_id = ${users[0].id}`,
      ).toHaveLength(1);
      expect(await service.login(email, codeFor(email))).toBeNull();
    });

    test('five concurrent wrong guesses exhaust the code', async () => {
      const email = 'attempts@example.invalid';
      await service.send(email);
      const code = codeFor(email);
      const wrong = code === '000000' ? '111111' : '000000';
      expect(
        await Promise.all(
          Array.from({ length: 12 }, () => service.verify(email, wrong)),
        ),
      ).toEqual(Array(12).fill(false));
      const [row] =
        await sql`SELECT attempts FROM email_verifications WHERE email = ${email}`;
      expect(row.attempts).toBe(5);
      expect(await service.login(email, code)).toBeNull();
    });

    test('expiry, replacement and cross-email checks reject old proofs', async () => {
      const email = 'expiry@example.invalid';
      await service.send(email);
      const code = codeFor(email);
      expect(await service.verify('different@example.invalid', code)).toBe(
        false,
      );
      await sql`UPDATE email_verifications SET expires_at = now() WHERE email = ${email}`;
      expect(await service.verify(email, code)).toBe(false);
      await service.send(email);
      expect(await service.verify(email, codeFor(email))).toBe(true);
      expect(await service.login(email, codeFor(email))).toBeNull();
    });

    test('a changed protection key cannot redeem an outstanding code', async () => {
      const email = 'key@example.invalid';
      await service.send(email);
      const changed = createEmailService(
        sql,
        'another-synthetic-key'.repeat(4),
        async () => {},
      );
      expect(await changed.verify(email, codeFor(email))).toBe(false);
    });

    test('failed and pending delivery never enable redemption', async () => {
      const email = 'failure@example.invalid';
      const failed = createEmailService(sql, secret, async (_, code) => {
        expect(await service.verify(email, code)).toBe(false);
        throw new Error('provider includes private input');
      });
      await expect(failed.send(email)).rejects.toThrow(
        'Authentication unavailable',
      );
      expect(
        await sql`SELECT id FROM email_verifications WHERE email = ${email}`,
      ).toHaveLength(0);
    });

    test('a late delivery cannot activate or remove a replacement code', async () => {
      const email = 'late@example.invalid';
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const late = createEmailService(sql, secret, async () => {
        started.resolve();
        await release.promise;
      });
      const first = late.send(email);
      await started.promise;
      await service.send(email);
      release.resolve();
      await expect(first).rejects.toThrow('Authentication unavailable');
      expect(await service.verify(email, codeFor(email))).toBe(true);
    });

    test('session insertion failure rolls back user creation and code consumption', async () => {
      const email = 'rollback@example.invalid';
      await service.send(email);
      await sql.unsafe(`CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
      CREATE TRIGGER reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_session()`);
      try {
        await expect(service.login(email, codeFor(email))).rejects.toThrow();
        expect(
          await sql`SELECT id FROM users WHERE email = ${email}`,
        ).toHaveLength(0);
        const [row] =
          await sql`SELECT used, attempts FROM email_verifications WHERE email = ${email}`;
        expect(row.used).toBe(false);
        expect(row.attempts).toBe(0);
      } finally {
        await sql.unsafe(
          'DROP TRIGGER reject_session ON sessions; DROP FUNCTION reject_session()',
        );
      }
      expect(await service.login(email, codeFor(email))).not.toBeNull();
    });

    test('exact email identities remain separate and existing accounts are reused', async () => {
      for (const email of ['case@example.invalid', 'Case@example.invalid']) {
        await service.send(email);
        await service.login(email, codeFor(email));
        await service.send(email);
        await service.login(email, codeFor(email));
        const users = await sql`SELECT id FROM users WHERE email = ${email}`;
        expect(users).toHaveLength(1);
        expect(
          await sql`SELECT id FROM sessions WHERE user_id = ${users[0].id}`,
        ).toHaveLength(2);
      }
    });
  },
);
