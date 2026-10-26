import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { AuthError } from './error';
import { isCode, isEmail } from './http';
import {
  matchesReviewCode,
  normalizeEmailIdentity,
  reviewCodeDigest,
} from './review-credential';
import { generateId, insertSession } from './session-record';

export const CODE_ATTEMPTS = 5;
export const CODE_EXPIRY_MINUTES = 10;

export async function lockEmailIdentity(sql: postgres.ISql, email: string) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalizeEmailIdentity(email)}, 734109))`;
}

export function createEmailService(
  sql: postgres.Sql,
  secret: string,
  deliver: (email: string, code: string) => Promise<void>,
) {
  if (Buffer.byteLength(secret) < 32)
    throw new AuthError(503, 'Authentication unavailable');
  const digest = (id: string, email: string, code: string) =>
    createHmac('sha256', secret)
      .update(JSON.stringify([id, email, code]))
      .digest('hex');

  const redeem = async (
    tx: postgres.TransactionSql,
    email: string,
    code: string,
  ): Promise<boolean> => {
    const [row] = await tx`
        UPDATE email_verifications SET attempts = attempts + 1
        WHERE email = ${email} AND ready AND NOT used
          AND expires_at > clock_timestamp() AND attempts < ${CODE_ATTEMPTS}
        RETURNING id, code_digest
      `;
    if (!row) return false;
    const expected = Buffer.from(row.code_digest, 'hex');
    const supplied = Buffer.from(digest(row.id, email, code), 'hex');
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return false;
    await tx`UPDATE email_verifications SET used = true WHERE id = ${row.id}`;
    return true;
  };

  return {
    async send(email: string) {
      const id = generateId();
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const codeDigest = digest(id, email, code);
      await sql.begin(async (tx) => {
        await lockEmailIdentity(tx, email);
        await tx`DELETE FROM email_verifications WHERE email = ${email}`;
        await tx`
          INSERT INTO email_verifications (id, email, code_digest, expires_at)
          VALUES (${id}, ${email}, ${codeDigest}, clock_timestamp() + interval '1 minute' * ${CODE_EXPIRY_MINUTES})
        `;
      });
      try {
        await deliver(email, code);
        const activated = await sql.begin(async (tx) => {
          await lockEmailIdentity(tx, email);
          return tx`
            UPDATE email_verifications SET ready = true
            WHERE id = ${id} AND NOT used AND expires_at > clock_timestamp()
            RETURNING id
          `;
        });
        if (activated.length !== 1) throw new Error();
      } catch {
        await sql`DELETE FROM email_verifications WHERE id = ${id}`;
        throw new AuthError(503, 'Authentication unavailable');
      }
    },
    async verify(email: string, code: string) {
      return sql.begin(async (tx) => {
        await lockEmailIdentity(tx, email);
        return redeem(tx, email, code);
      });
    },
    async login(email: string, code: string) {
      if (!isEmail(email) || !isCode(code)) return null;
      return sql.begin(async (tx) => {
        await lockEmailIdentity(tx, email);
        const [review] = await tx`
          SELECT r.store, r.user_id, r.code_digest, u.email
          FROM review_accounts r JOIN users u ON u.id = r.user_id
          WHERE lower(u.email) = ${normalizeEmailIdentity(email)}
        `;
        if (
          review &&
          matchesReviewCode(
            review.code_digest,
            reviewCodeDigest(secret, review.store, review.email, code),
          )
        ) {
          const [user] = await tx`
            SELECT id FROM users WHERE id = ${review.user_id} AND email = ${review.email} FOR UPDATE
          `;
          return user ? insertSession(tx, user.id) : null;
        }
        if (!(await redeem(tx, email, code))) return null;
        if (review) return insertSession(tx, review.user_id);
        await tx`
          INSERT INTO users (id, email) VALUES (${generateId()}, ${email})
          ON CONFLICT (email) DO NOTHING
        `;
        const [user] =
          await tx`SELECT id FROM users WHERE email = ${email} FOR UPDATE`;
        return insertSession(tx, user.id);
      });
    },
  };
}
