import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { createEmailHandlers } from './email-handlers';
import { createEmailService } from './email-service';
import { AuthError } from './error';
import { reviewCodeDigest } from './review-credential';

const secret = 'synthetic-review-secret'.repeat(3);
const email = 'review@example.invalid';
const code = '012345';

describe.skipIf(!process.env.PG_BIN)(
  'review login on disposable PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let service: ReturnType<typeof createEmailService>;
    const delivered = new Map<string, string>();

    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 5 });
      await createSchemaFixture(sql);
      await sql`INSERT INTO users (id, email) VALUES ('review-user', ${email}), ('ordinary', 'ordinary@example.invalid')`;
      await sql`
      INSERT INTO review_accounts (store, user_id, code_digest, operation_id, operation_digest, operation_kind, submission)
      VALUES ('apple', 'review-user', ${reviewCodeDigest(secret, 'apple', email, code)}, ${randomUUID()}, ${'0'.repeat(64)}, 'create', 'synthetic')
    `;
      service = createEmailService(sql, secret, async (address, sent) => {
        delivered.set(address, sent);
      });
    }, 30_000);

    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    test('repeated normalized login needs no email verification and creates normal sessions', async () => {
      for (const address of [email, email.toUpperCase(), email]) {
        const session = await service.login(address, code);
        expect(session).not.toBeNull();
        const [stored] =
          await sql`SELECT user_id, expires_at FROM sessions WHERE id = ${session?.id ?? ''}`;
        expect(stored.user_id).toBe('review-user');
        expect(stored.expires_at.getTime() - Date.now()).toBeGreaterThan(
          29 * 86_400_000,
        );
      }
      expect(await sql`SELECT * FROM email_verifications`).toHaveLength(0);
      expect(await service.verify(email, code)).toBe(false);
      expect(await service.login('ordinary@example.invalid', code)).toBeNull();
      expect(await service.login('missing@example.invalid', code)).toBeNull();
      expect(await sql`SELECT * FROM users`).toHaveLength(2);
    });

    test('ordinary OTPs work independently before and after expiry, consumption and exhaustion', async () => {
      for (const address of [email, email.toUpperCase()]) {
        await service.send(address);
        const otp = delivered.get(address) ?? '';
        const [before] =
          await sql`SELECT * FROM email_verifications WHERE email = ${address}`;
        expect(await service.login(address, code)).not.toBeNull();
        const [after] =
          await sql`SELECT * FROM email_verifications WHERE email = ${address}`;
        expect(after).toEqual(before);
        const session = await service.login(address, otp);
        expect(session).not.toBeNull();
        expect(
          (
            await sql`SELECT user_id FROM sessions WHERE id = ${session?.id ?? ''}`
          )[0].user_id,
        ).toBe('review-user');
        expect(await service.login(address, otp)).toBeNull();
        expect(await service.login(address, code)).not.toBeNull();
        await service.send(address);
        await sql`UPDATE email_verifications SET expires_at = now(), attempts = 5 WHERE email = ${address}`;
        expect(await service.login(address, code)).not.toBeNull();
      }
      expect(await sql`SELECT * FROM users`).toHaveLength(2);
    });

    test('shared limits and delivery failures remain fail closed', async () => {
      const request = () =>
        new Request('https://example.invalid', {
          method: 'POST',
          body: JSON.stringify({ email, code }),
        });
      for (const error of [
        new AuthError(429, 'Too many authentication requests', 60),
        new Error('Redis unavailable'),
      ]) {
        const handlers = createEmailHandlers(
          () => service,
          async () => {
            throw error;
          },
          async () => {
            throw new Error('must not set cookie');
          },
        );
        expect((await handlers.login(request())).status).toBe(
          error instanceof AuthError ? 429 : 503,
        );
      }
      const failing = createEmailService(sql, secret, async () => {
        throw new Error('delivery unavailable');
      });
      await expect(failing.send(email)).rejects.toThrow(
        'Authentication unavailable',
      );
      expect(await service.login(email, code)).not.toBeNull();
    });

    test('read-only registration access suffices and a backend failure never falls back', async () => {
      await sql`CREATE ROLE review_runtime LOGIN`;
      await sql`GRANT USAGE ON SCHEMA public TO review_runtime`;
      await sql`GRANT SELECT ON review_accounts TO review_runtime`;
      await sql`GRANT SELECT, INSERT, UPDATE ON users, sessions TO review_runtime`;
      await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON email_verifications TO review_runtime`;
      const runtime = postgres({
        ...cluster.options,
        username: 'review_runtime',
      });
      try {
        const login = createEmailService(runtime, secret, async () => {});
        expect(await login.login(email, code)).not.toBeNull();
        await expect(
          runtime`UPDATE review_accounts SET code_digest = ${'0'.repeat(64)}`.execute(),
        ).rejects.toThrow();
        await sql`REVOKE SELECT ON review_accounts FROM review_runtime`;
        await expect(login.login(email, code)).rejects.toThrow();
      } finally {
        await runtime.end();
      }
    });

    test('rotation, secret changes and registration deletion revoke reusable access', async () => {
      const changed = createEmailService(
        sql,
        `${secret}changed`,
        async () => {},
      );
      expect(await changed.login(email, code)).toBeNull();
      const next = '054321';
      await sql`UPDATE review_accounts SET code_digest = ${reviewCodeDigest(secret, 'apple', email, next)}`;
      expect(await service.login(email, code)).toBeNull();
      expect(await service.login(email, next)).not.toBeNull();
      await sql`DELETE FROM users WHERE id = 'review-user'`;
      expect(await sql`SELECT * FROM review_accounts`).toHaveLength(0);
      expect(await service.login(email, next)).toBeNull();
      expect(
        await sql`SELECT id FROM users WHERE email = ${email}`,
      ).toHaveLength(0);
    });
  },
);
