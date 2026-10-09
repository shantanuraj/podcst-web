import {
  createHmac,
  type KeyObject,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type postgres from 'postgres';
import { requireActiveAccount } from '../auth/account-guard';
import { lockEmailIdentity } from '../auth/email-service';
import { AuthError } from '../auth/error';
import {
  canonical,
  digest,
  ERASURE_PROOF_MS,
  ERASURE_RETRY_SECONDS,
  type ErasurePayload,
  isOperationId,
  type JournalClient,
  type JournalEntry,
  parsePayload,
  payloadHash,
  RECEIPT_LIFETIME_MS,
  type Signed,
  verifyEntry,
} from './journal-contract';

const CLAIM_MS = 60_000;
type Session = { id: string; userId: string; email: string };
type Outcome = { status: 'pending' | 'completed'; operationId: string };
interface Intent {
  operation_id: string;
  action: ErasurePayload['action'];
  account_id: string;
  credential_id: string | null;
  accepted_at: Date;
  receipt_expires_at: Date;
  applied_at: Date | null;
  claim_token: string | null;
  claim_expires_at: Date | null;
  publication: unknown;
}
const toPayload = (row: Intent): ErasurePayload =>
  parsePayload({
    version: 1,
    operationId: row.operation_id,
    accountId: row.account_id,
    acceptedAt: row.accepted_at.toISOString(),
    ...(row.action === 'erase_account'
      ? { action: row.action }
      : { action: row.action, credentialId: row.credential_id }),
  });

async function applyErasure(tx: postgres.TransactionSql, raw: ErasurePayload) {
  const payload = parsePayload(raw);
  if (payload.action === 'erase_account') {
    const [identity] =
      await tx`SELECT email FROM users WHERE id = ${payload.accountId}`;
    if (identity) await lockEmailIdentity(tx, identity.email);
    const [locked] =
      await tx`SELECT email FROM users WHERE id = ${payload.accountId} FOR UPDATE`;
    if (locked && locked.email !== identity?.email)
      throw new AuthError(503, 'Account operation unavailable');
    if (locked)
      await tx`DELETE FROM email_verifications WHERE email = ${locked.email}`;
    const authors =
      await tx`SELECT DISTINCT author_id FROM podcasts WHERE owner_user_id = ${payload.accountId}`;
    await tx`DELETE FROM users WHERE id = ${payload.accountId}`;
    if (authors.length)
      await tx`
      DELETE FROM authors a WHERE a.id = ANY(${authors.map(({ author_id }) => author_id)}::int[])
        AND a.itunes_id IS NULL AND NOT EXISTS (SELECT 1 FROM podcasts p WHERE p.author_id = a.id)
    `;
  } else {
    await tx`SELECT id FROM users WHERE id = ${payload.accountId} FOR UPDATE`;
    await tx`DELETE FROM passkeys WHERE user_id = ${payload.accountId} AND id = ${payload.credentialId}`;
  }
}

export function createErasureService(
  sql: postgres.Sql,
  {
    journal,
    journalId,
    epoch,
    keys,
    proofSecret,
    deliver,
    now = () => new Date(),
  }: {
    journal: JournalClient;
    journalId: string;
    epoch: string;
    keys: ReadonlyMap<string, KeyObject>;
    proofSecret: string;
    deliver: (email: string, code: string) => Promise<void>;
    now?: () => Date;
  },
) {
  if (
    Buffer.byteLength(proofSecret) < 32 ||
    !isOperationId(journalId) ||
    !isOperationId(epoch)
  )
    throw new AuthError(503, 'Account operation unavailable');
  const proofDigest = (session: Session, operationId: string, code: string) =>
    createHmac('sha256', proofSecret)
      .update(
        canonical([
          'erase_account',
          session.userId,
          session.id,
          operationId,
          code,
        ]),
      )
      .digest();
  const sessionUser = async (
    tx: postgres.TransactionSql,
    session: Session,
    lock: 'share' | 'update',
  ) => {
    await lockEmailIdentity(tx, session.email);
    const user = await requireActiveAccount(tx, session.userId, lock);
    const [active] =
      await tx`SELECT id FROM sessions WHERE id = ${session.id} AND user_id = ${user.id} AND expires_at > ${now()} FOR SHARE`;
    if (!active || user.email !== session.email)
      throw new AuthError(401, 'Authentication required');
    return user;
  };
  const load = async (operationId: string) => {
    const [row] = await sql<
      Intent[]
    >`SELECT * FROM account_erasure_intents WHERE operation_id = ${operationId}`;
    return row;
  };
  const complete = async (envelope: Signed<JournalEntry>, claim?: string) => {
    const entry = verifyEntry(envelope, keys, journalId);
    const payload = entry.payload;
    const { payload: _payload, ...metadata } = entry;
    const publication = { ...envelope, value: metadata };
    return sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '3s'`;
      await tx`SET LOCAL statement_timeout = '10s'`;
      const [identity] =
        await tx`SELECT email FROM users WHERE id = ${payload.accountId}`;
      if (payload.action === 'erase_account' && identity)
        await lockEmailIdentity(tx, identity.email);
      await tx`SELECT id FROM users WHERE id = ${payload.accountId} FOR UPDATE`;
      if (!claim) {
        await tx`
          INSERT INTO account_erasure_intents (operation_id, action, account_id, credential_id, accepted_at, receipt_expires_at)
          VALUES (${payload.operationId}, ${payload.action}, ${payload.accountId}, ${payload.action === 'revoke_passkey' ? payload.credentialId : null},
            ${new Date(payload.acceptedAt)}, ${new Date(Date.parse(payload.acceptedAt) + RECEIPT_LIFETIME_MS)})
          ON CONFLICT (operation_id) DO NOTHING
        `;
      }
      const [intent] = await tx<
        Intent[]
      >`SELECT * FROM account_erasure_intents WHERE operation_id = ${payload.operationId} FOR UPDATE`;
      if (!intent || payloadHash(toPayload(intent)) !== payloadHash(payload))
        throw new AuthError(503, 'Account operation unavailable');
      if (
        claim &&
        (intent.claim_token !== claim ||
          !intent.claim_expires_at ||
          intent.claim_expires_at <= now())
      )
        return false;
      await applyErasure(tx, payload);
      await tx`UPDATE account_erasure_intents SET publication = ${tx.json(publication)}, applied_at = coalesce(applied_at, ${now()}) WHERE operation_id = ${payload.operationId}`;
      return true;
    });
  };
  const reconcile = async (operationId: string): Promise<Outcome> => {
    if (!isOperationId(operationId))
      throw new AuthError(400, 'Invalid account operation');
    const token = randomUUID();
    const [intent] = await sql<Intent[]>`
      UPDATE account_erasure_intents SET claim_token = ${token}, claim_expires_at = ${new Date(now().getTime() + CLAIM_MS)},
        next_attempt_at = ${new Date(now().getTime() + ERASURE_RETRY_SECONDS * 1000)}
      WHERE operation_id = ${operationId} AND (claim_token IS NULL OR claim_expires_at <= ${now()}) RETURNING *
    `;
    if (!intent) return { status: 'pending', operationId };
    try {
      const payload = toPayload(intent);
      const publication =
        (await journal.lookup(operationId, payloadHash(payload))) ??
        (await journal.publish(epoch, payload));
      const entry = verifyEntry(publication, keys, journalId);
      if (payloadHash(entry.payload) !== payloadHash(payload))
        throw new AuthError(503, 'Account operation unavailable');
      return {
        status: (await complete(publication, token)) ? 'completed' : 'pending',
        operationId,
      };
    } catch {
      return { status: 'pending', operationId };
    } finally {
      await sql`UPDATE account_erasure_intents SET claim_token = NULL, claim_expires_at = NULL WHERE operation_id = ${operationId} AND claim_token = ${token}`;
    }
  };

  return {
    async prepare(session: Session) {
      const operationId = randomUUID();
      const receipt = randomBytes(32).toString('base64url');
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + RECEIPT_LIFETIME_MS);
      const proofExpiresAt = new Date(createdAt.getTime() + ERASURE_PROOF_MS);
      await sql.begin(async (tx) => {
        await sessionUser(tx, session, 'share');
        await tx`DELETE FROM account_erasure_proofs WHERE expires_at <= ${now()}`;
        await tx`
          INSERT INTO account_erasure_proofs (operation_id, user_id, session_id, code_digest, expires_at, receipt_expires_at)
          VALUES (${operationId}, ${session.userId}, ${session.id}, ${proofDigest(session, operationId, code).toString('hex')}, ${proofExpiresAt}, ${expiresAt})
        `;
      });
      try {
        await journal.registerReceipt({
          digest: digest(receipt),
          operationId,
          expiresAt: expiresAt.toISOString(),
        });
        await deliver(session.email, code);
        await sql.begin(async (tx) => {
          await sessionUser(tx, session, 'share');
          const ready =
            await tx`UPDATE account_erasure_proofs SET ready = true WHERE operation_id = ${operationId} AND expires_at > ${now()} RETURNING operation_id`;
          if (!ready.length)
            throw new AuthError(503, 'Account operation unavailable');
        });
      } catch {
        await sql`DELETE FROM account_erasure_proofs WHERE operation_id = ${operationId}`;
        throw new AuthError(503, 'Account operation unavailable');
      }
      return {
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
      if (!confirmed || !isOperationId(operationId) || !/^\d{6}$/.test(code))
        throw new AuthError(400, 'Invalid account operation');
      const accepted = await sql.begin(async (tx) => {
        await sessionUser(tx, session, 'update');
        const [proof] = await tx`
          UPDATE account_erasure_proofs SET attempts = attempts + 1
          WHERE operation_id = ${operationId} AND user_id = ${session.userId} AND session_id = ${session.id}
            AND ready AND expires_at > ${now()} AND attempts < 5
          RETURNING code_digest, receipt_expires_at
        `;
        if (
          !proof ||
          !timingSafeEqual(
            Buffer.from(proof.code_digest, 'hex'),
            proofDigest(session, operationId, code),
          )
        )
          return false;
        await tx`
          INSERT INTO account_erasure_intents (operation_id, action, account_id, accepted_at, receipt_expires_at)
          VALUES (${operationId}, 'erase_account', ${session.userId}, ${now()}, ${proof.receipt_expires_at})
        `;
        await tx`DELETE FROM account_erasure_proofs WHERE operation_id = ${operationId}`;
        return true;
      });
      if (!accepted)
        throw new AuthError(400, 'Invalid or expired deletion proof');
      return reconcile(operationId);
    },
    async revoke(session: Session, credentialId: string) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(credentialId))
        throw new AuthError(400, 'Invalid account operation');
      const operationId = await sql.begin(async (tx) => {
        await sessionUser(tx, session, 'update');
        const [existing] =
          await tx`SELECT operation_id FROM account_erasure_intents WHERE account_id = ${session.userId} AND credential_id = ${credentialId} AND action = 'revoke_passkey'`;
        if (existing) return existing.operation_id as string;
        const [key] =
          await tx`SELECT id FROM passkeys WHERE id = ${credentialId} AND user_id = ${session.userId} FOR UPDATE`;
        if (!key) throw new AuthError(404, 'Passkey not found');
        const operationId = randomUUID();
        const accepted = now();
        await tx`
          INSERT INTO account_erasure_intents (operation_id, action, account_id, credential_id, accepted_at, receipt_expires_at)
          VALUES (${operationId}, 'revoke_passkey', ${session.userId}, ${credentialId}, ${accepted}, ${new Date(accepted.getTime() + RECEIPT_LIFETIME_MS)})
        `;
        return operationId;
      });
      return reconcile(operationId);
    },
    reconcile,
    async reconcilePending(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new AuthError(400, 'Invalid account operation');
      const rows = await sql`
        SELECT operation_id FROM account_erasure_intents
        WHERE applied_at IS NULL AND next_attempt_at <= ${now()}
          AND (claim_token IS NULL OR claim_expires_at <= ${now()})
        ORDER BY next_attempt_at, accepted_at LIMIT ${limit}
      `;
      const results: Outcome[] = [];
      for (const row of rows) results.push(await reconcile(row.operation_id));
      await sql`DELETE FROM account_erasure_proofs WHERE expires_at <= ${now()}`;
      await sql`DELETE FROM account_erasure_intents WHERE applied_at IS NOT NULL AND receipt_expires_at <= ${now()} AND claim_token IS NULL`;
      return results;
    },
    async status(
      receipt: string,
    ): Promise<{ status: 'pending' | 'completed' | 'unknown' }> {
      if (!/^[A-Za-z0-9_-]{43}$/.test(receipt)) return { status: 'unknown' };
      const resolution = await journal.resolveReceipt(digest(receipt));
      if (!resolution) return { status: 'unknown' };
      if (resolution.entry) {
        if (resolution.entry.value.payload.action !== 'erase_account')
          return { status: 'unknown' };
        await complete(resolution.entry);
        return { status: 'completed' };
      }
      if (!(await load(resolution.operationId))) return { status: 'unknown' };
      const result = await reconcile(resolution.operationId);
      return { status: result.status };
    },
    replay: complete,
  };
}
