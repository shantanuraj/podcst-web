import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type postgres from 'postgres';
import { isAccountOperationId } from '@/shared/account-erasure';
import { requireActiveAccount } from '../auth/account-guard';
import { lockEmailIdentity } from '../auth/email-service';
import { AuthError } from '../auth/error';
import type { DeletionRecord } from './record';

export const DELETION_PROOF_MINUTES = 5;
export const DELETION_RECEIPT_DAYS = 7;
type Session = { id: string; userId: string; email: string };
type Outcome = { operationId: string; status: 'pending' | 'completed' };
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export async function eraseAccount(
  tx: postgres.TransactionSql,
  accountId: string,
) {
  const [identity] = await tx`SELECT email FROM users WHERE id = ${accountId}`;
  if (identity) await lockEmailIdentity(tx, identity.email);
  const [user] =
    await tx`SELECT email FROM users WHERE id = ${accountId} FOR UPDATE`;
  if (user && user.email !== identity?.email)
    throw new Error('Account identity changed');
  if (user)
    await tx`DELETE FROM email_verifications WHERE email = ${user.email}`;
  const authors =
    await tx`SELECT DISTINCT author_id FROM podcasts WHERE owner_user_id = ${accountId}`;
  await tx`DELETE FROM users WHERE id = ${accountId}`;
  if (authors.length)
    await tx`
    DELETE FROM authors a WHERE a.id = ANY(${authors.map((row) => row.author_id)}::int[])
      AND a.itunes_id IS NULL AND NOT EXISTS (SELECT 1 FROM podcasts p WHERE p.author_id = a.id)
  `;
}

export function createDeletionService(
  sql: postgres.Sql,
  {
    secret,
    publish,
    deliver,
    now = () => new Date(),
  }: {
    secret: string;
    publish: (record: DeletionRecord) => Promise<{ signature: string }>;
    deliver: (email: string, code: string) => Promise<void>;
    now?: () => Date;
  },
) {
  if (Buffer.byteLength(secret) < 32)
    throw new AuthError(503, 'Account deletion unavailable');
  const codeDigest = (session: Session, operationId: string, code: string) =>
    createHmac('sha256', secret)
      .update(
        JSON.stringify([
          'delete-account',
          session.userId,
          session.id,
          operationId,
          code,
        ]),
      )
      .digest();
  const active = async (tx: postgres.TransactionSql, session: Session) => {
    await lockEmailIdentity(tx, session.email);
    await tx`SELECT id FROM users WHERE id = ${session.userId} FOR UPDATE`;
    const user = await requireActiveAccount(tx, session.userId);
    const [valid] =
      await tx`SELECT id FROM sessions WHERE id = ${session.id} AND user_id = ${session.userId} AND expires_at > ${now()} FOR SHARE`;
    if (!valid || user.email !== session.email)
      throw new AuthError(401, 'Authentication required');
  };
  const reconcile = async (operationId: string): Promise<Outcome> => {
    const [intent] =
      await sql`SELECT * FROM account_erasure_intents WHERE operation_id = ${operationId} AND action = 'erase_account'`;
    if (!intent) throw new AuthError(404, 'Deletion request unavailable');
    if (intent.applied_at) return { operationId, status: 'completed' };
    try {
      const publication = await publish({
        operationId,
        accountId: intent.account_id,
        acceptedAt: intent.accepted_at.toISOString(),
      });
      await sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '3s'`;
        await tx`SET LOCAL statement_timeout = '10s'`;
        await eraseAccount(tx, intent.account_id);
        await tx`UPDATE account_erasure_intents SET publication = ${tx.json(publication)}, applied_at = coalesce(applied_at, ${now()}) WHERE operation_id = ${operationId}`;
      });
      return { operationId, status: 'completed' };
    } catch {
      return { operationId, status: 'pending' };
    }
  };
  return {
    async prepare(session: Session, accountId: string) {
      if (accountId !== session.userId)
        throw new AuthError(409, 'Account changed; sign in again');
      const operationId = randomUUID();
      const receipt = randomBytes(32).toString('base64url');
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(
        now().getTime() + DELETION_RECEIPT_DAYS * 86400_000,
      );
      const proofExpiresAt = new Date(
        now().getTime() + DELETION_PROOF_MINUTES * 60_000,
      );
      await sql.begin(async (tx) => {
        await active(tx, session);
        await tx`DELETE FROM account_erasure_proofs WHERE user_id = ${session.userId} OR expires_at <= ${now()}`;
        await tx`INSERT INTO account_erasure_proofs (operation_id, user_id, session_id, code_digest, expires_at, receipt_expires_at)
          VALUES (${operationId}, ${session.userId}, ${session.id}, ${codeDigest(session, operationId, code).toString('hex')}, ${proofExpiresAt}, ${expiresAt})`;
        await tx`INSERT INTO account_deletion_receipts (digest, operation_id, expires_at) VALUES (${digest(receipt)}, ${operationId}, ${expiresAt})`;
      });
      try {
        await deliver(session.email, code);
        const ready =
          await sql`UPDATE account_erasure_proofs SET ready = true WHERE operation_id = ${operationId} AND expires_at > ${now()} RETURNING operation_id`;
        if (!ready.length) throw new Error();
      } catch {
        await sql`DELETE FROM account_erasure_proofs WHERE operation_id = ${operationId}`;
        throw new AuthError(503, 'Unable to send deletion code; try again');
      }
      return {
        accountId,
        operationId,
        receipt,
        expiresAt: expiresAt.toISOString(),
        proofExpiresAt: proofExpiresAt.toISOString(),
      };
    },
    async accept(
      session: Session,
      operationId: string,
      code: string,
      confirmed: boolean,
    ) {
      if (
        !confirmed ||
        !isAccountOperationId(operationId) ||
        !/^\d{6}$/.test(code)
      )
        throw new AuthError(400, 'Invalid deletion request');
      const accepted = await sql.begin(async (tx) => {
        await active(tx, session);
        const [proof] =
          await tx`UPDATE account_erasure_proofs SET attempts = attempts + 1
          WHERE operation_id = ${operationId} AND user_id = ${session.userId} AND session_id = ${session.id}
            AND ready AND expires_at > ${now()} AND attempts < 5 RETURNING code_digest, receipt_expires_at`;
        if (
          !proof ||
          !timingSafeEqual(
            Buffer.from(proof.code_digest, 'hex'),
            codeDigest(session, operationId, code),
          )
        )
          return false;
        await tx`INSERT INTO account_erasure_intents (operation_id, action, account_id, accepted_at, receipt_expires_at)
          VALUES (${operationId}, 'erase_account', ${session.userId}, ${now()}, ${proof.receipt_expires_at})`;
        await tx`DELETE FROM account_erasure_proofs WHERE user_id = ${session.userId}`;
        await tx`DELETE FROM sessions WHERE user_id = ${session.userId}`;
        await tx`DELETE FROM email_verifications WHERE email = ${session.email}`;
        return true;
      });
      if (!accepted)
        throw new AuthError(422, 'Invalid or expired deletion code');
      return reconcile(operationId);
    },
    async status(receipt: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(receipt))
        return { status: 'unknown' as const };
      const [row] =
        await sql`SELECT i.operation_id FROM account_deletion_receipts r
        JOIN account_erasure_intents i USING (operation_id) WHERE r.digest = ${digest(receipt)} AND r.expires_at > ${now()}`;
      if (!row) return { status: 'unknown' as const };
      const outcome = await reconcile(row.operation_id);
      return { status: outcome.status };
    },
    async reconcilePending() {
      const rows =
        await sql`SELECT operation_id FROM account_erasure_intents WHERE action = 'erase_account' AND applied_at IS NULL ORDER BY accepted_at LIMIT 100`;
      for (const row of rows) await reconcile(row.operation_id);
      await sql`DELETE FROM account_erasure_proofs WHERE expires_at <= ${now()}`;
      await sql`DELETE FROM account_deletion_receipts WHERE expires_at <= ${now()}`;
      await sql`DELETE FROM account_erasure_intents WHERE action = 'erase_account' AND applied_at IS NOT NULL AND receipt_expires_at <= ${now()}`;
      const [remaining] =
        await sql`SELECT count(*)::int AS pending, min(accepted_at) AS oldest FROM account_erasure_intents WHERE action = 'erase_account' AND applied_at IS NULL`;
      return remaining as { pending: number; oldest: Date | null };
    },
  };
}
