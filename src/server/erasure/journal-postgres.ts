import {
  createCipheriv,
  createDecipheriv,
  type KeyObject,
  randomBytes,
} from 'node:crypto';
import type postgres from 'postgres';
import {
  canonical,
  type ErasurePayload,
  entryHash,
  isDigest,
  isInstant,
  isOperationId,
  isSequence,
  JOURNAL_GENESIS,
  type JournalClient,
  type JournalEntry,
  JournalError,
  type JournalHead,
  parsePayload,
  payloadHash,
  RECEIPT_LIFETIME_MS,
  type ReceiptRegistration,
  type Signed,
  signValue,
  verifyEntry,
  verifyReplay,
  verifyValue,
} from './journal-contract';

type HeadRow = {
  journal_id: string;
  epoch: string;
  sequence: string;
  revision: string;
  hash: string;
  sealed: boolean;
};
const headValue = (row: HeadRow): JournalHead => ({
  journalId: row.journal_id,
  epoch: row.epoch,
  sequence: String(row.sequence),
  revision: String(row.revision),
  hash: row.hash,
  sealed: row.sealed,
});

export interface JournalKeys {
  current: string;
  signing: KeyObject;
  verification: ReadonlyMap<string, KeyObject>;
  encryption: ReadonlyMap<string, Buffer>;
}

export function createPostgresJournal(
  sql: postgres.Sql,
  authority: postgres.Sql,
  receipts: postgres.Sql,
  journalId: string,
  keys: JournalKeys,
  now = () => new Date(),
) {
  if (
    !isOperationId(journalId) ||
    keys.signing.asymmetricKeyType !== 'ed25519' ||
    keys.verification.get(keys.current)?.asymmetricKeyType !== 'ed25519' ||
    keys.encryption.get(keys.current)?.length !== 32
  )
    throw new JournalError(503);
  const sign = <T>(value: T) => signValue(value, keys.current, keys.signing);
  verifyValue(sign({ journalId }), keys.verification);
  const encode = (entry: Signed<JournalEntry>) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      keys.encryption.get(keys.current) as Buffer,
      iv,
    );
    cipher.setAAD(
      Buffer.from(
        canonical([
          journalId,
          entry.value.sequence,
          entry.value.payload.operationId,
          keys.current,
        ]),
      ),
    );
    const encrypted = Buffer.concat([
      cipher.update(canonical(entry)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  };
  const decode = (row: {
    key_id: string;
    body: Buffer;
    sequence: string;
    operation_id: string;
  }) => {
    try {
      const key = keys.encryption.get(row.key_id);
      if (key?.length !== 32) throw new Error();
      const data = Buffer.from(row.body);
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAAD(
        Buffer.from(
          canonical([
            journalId,
            String(row.sequence),
            row.operation_id,
            row.key_id,
          ]),
        ),
      );
      cipher.setAuthTag(data.subarray(12, 28));
      const result = JSON.parse(
        Buffer.concat([
          cipher.update(data.subarray(28)),
          cipher.final(),
        ]).toString(),
      ) as Signed<JournalEntry>;
      const entry = verifyEntry(result, keys.verification, journalId);
      if (
        entry.sequence !== String(row.sequence) ||
        entry.payload.operationId !== row.operation_id
      )
        throw new Error();
      return result;
    } catch {
      throw new JournalError(503);
    }
  };
  const readHead = async (
    tx: postgres.ISql,
    lock: 'share' | 'update' = 'share',
  ) => {
    const [row] = await tx<HeadRow[]>`
      SELECT journal_id, epoch, sequence::text, revision::text, hash, sealed
      FROM erasure_journal.head WHERE singleton ${lock === 'share' ? tx`FOR SHARE` : tx`FOR UPDATE`}
    `;
    if (!row || row.journal_id !== journalId) throw new JournalError(503);
    return headValue(row);
  };
  const readEntry = async (tx: postgres.ISql, operationId: string) => {
    const [row] =
      await tx`SELECT sequence::text, operation_id, key_id, body FROM erasure_journal.entries WHERE operation_id = ${operationId}`;
    return row ? decode(row as Parameters<typeof decode>[0]) : null;
  };
  const range = async (tx: postgres.ISql, sequence: string, through: string) =>
    (
      await tx`SELECT sequence::text, operation_id, key_id, body FROM erasure_journal.entries WHERE sequence > ${sequence}::bigint AND sequence <= ${through}::bigint ORDER BY sequence`
    ).map((row) => decode(row as Parameters<typeof decode>[0]));

  const anchor = async () =>
    sql.begin(async (tx) => {
      const head = await readHead(tx);
      await authority.begin(async (control) => {
        await control`SET LOCAL synchronous_commit = on`;
        const [row] = await control<
          HeadRow[]
        >`SELECT journal_id, epoch, sequence::text, revision::text, hash, sealed FROM erasure_authority.head WHERE singleton FOR UPDATE`;
        if (!row || row.journal_id !== journalId) throw new JournalError(503);
        const previous = headValue(row);
        if (
          BigInt(previous.revision) > BigInt(head.revision) ||
          BigInt(previous.sequence) > BigInt(head.sequence)
        )
          throw new JournalError(503);
        if (previous.revision === head.revision) {
          if (canonical(previous) !== canonical(head))
            throw new JournalError(503);
        } else {
          const entries = await range(tx, previous.sequence, head.sequence);
          verifyReplay(
            entries,
            previous,
            sign({ ...head, sealed: true }),
            keys.verification,
          );
          await control`
          UPDATE erasure_authority.head SET epoch = ${head.epoch}, sequence = ${head.sequence}::bigint,
            revision = ${head.revision}::bigint, hash = ${head.hash}, sealed = ${head.sealed}
          WHERE singleton
        `;
        }
      });
      return head;
    });

  const client: JournalClient = {
    async publish(epoch: string, raw: ErasurePayload) {
      const payload = parsePayload(raw);
      if (!isOperationId(epoch)) throw new JournalError(400);
      await anchor();
      const entry = await sql.begin(async (tx) => {
        await tx`SET LOCAL synchronous_commit = on`;
        const head = await readHead(tx, 'update');
        if (head.epoch !== epoch || head.sealed) throw new JournalError(409);
        const existing = await readEntry(tx, payload.operationId);
        if (existing) {
          if (payloadHash(existing.value.payload) !== payloadHash(payload))
            throw new JournalError(409);
          return existing;
        }
        const value: JournalEntry = {
          journalId,
          epoch,
          sequence: String(BigInt(head.sequence) + 1n),
          previousHash: head.hash,
          publishedAt: now().toISOString(),
          payload,
        };
        const signed = sign(value);
        await tx`INSERT INTO erasure_journal.entries (sequence, operation_id, key_id, body) VALUES (${value.sequence}::bigint, ${payload.operationId}, ${keys.current}, ${encode(signed)})`;
        await tx`UPDATE erasure_journal.head SET sequence = ${value.sequence}::bigint, revision = revision + 1, hash = ${entryHash(value)} WHERE singleton`;
        return signed;
      });
      await anchor();
      return entry;
    },
    async lookup(operationId, hash) {
      if (!isOperationId(operationId) || !isDigest(hash))
        throw new JournalError(400);
      await anchor();
      const entry = await readEntry(sql, operationId);
      if (entry && payloadHash(entry.value.payload) !== hash)
        throw new JournalError(409);
      return entry;
    },
    async registerReceipt(receipt: ReceiptRegistration) {
      if (
        Object.keys(receipt).sort().join(',') !==
          'digest,expiresAt,operationId' ||
        !isDigest(receipt.digest) ||
        !isOperationId(receipt.operationId) ||
        !isInstant(receipt.expiresAt)
      )
        throw new JournalError(400);
      const expiry = new Date(receipt.expiresAt);
      const time = now();
      if (
        expiry.getTime() <= time.getTime() ||
        expiry.getTime() > time.getTime() + RECEIPT_LIFETIME_MS
      )
        throw new JournalError(400);
      await receipts.begin(async (tx) => {
        await tx`SET LOCAL synchronous_commit = on`;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${receipt.operationId}, 778019))`;
        await tx`DELETE FROM erasure_receipts.receipts WHERE expires_at <= ${time}`;
        const [existing] =
          await tx`SELECT digest, operation_id, expires_at FROM erasure_receipts.receipts WHERE digest = ${receipt.digest} OR operation_id = ${receipt.operationId}`;
        if (existing) {
          if (
            existing.digest !== receipt.digest ||
            existing.operation_id !== receipt.operationId ||
            existing.expires_at.toISOString() !== receipt.expiresAt
          )
            throw new JournalError(409);
          return;
        }
        if (await readEntry(sql, receipt.operationId))
          throw new JournalError(409);
        await tx`INSERT INTO erasure_receipts.receipts (digest, operation_id, expires_at) VALUES (${receipt.digest}, ${receipt.operationId}, ${expiry})`;
      });
    },
    async resolveReceipt(hash) {
      if (!isDigest(hash)) throw new JournalError(400);
      await anchor();
      const [row] =
        await receipts`SELECT operation_id FROM erasure_receipts.receipts WHERE digest = ${hash} AND expires_at > ${now()}`;
      return row
        ? {
            operationId: row.operation_id as string,
            entry: await readEntry(sql, row.operation_id),
          }
        : null;
    },
  };

  return {
    ...client,
    async purgeReceipts() {
      return receipts`DELETE FROM erasure_receipts.receipts WHERE expires_at <= ${now()}`;
    },
    async head() {
      return sign(await anchor());
    },
    async seal(epoch: string) {
      if (!isOperationId(epoch)) throw new JournalError(400);
      await anchor();
      await sql.begin(async (tx) => {
        await tx`SET LOCAL synchronous_commit = on`;
        const head = await readHead(tx, 'update');
        if (head.epoch !== epoch) throw new JournalError(409);
        if (!head.sealed)
          await tx`UPDATE erasure_journal.head SET sealed = true, revision = revision + 1 WHERE singleton`;
      });
      return sign(await anchor());
    },
    async openEpoch(expected: JournalHead, epoch: string) {
      if (!isOperationId(epoch) || epoch === expected.epoch)
        throw new JournalError(400);
      await anchor();
      await sql.begin(async (tx) => {
        await tx`SET LOCAL synchronous_commit = on`;
        const head = await readHead(tx, 'update');
        if (!head.sealed || canonical(head) !== canonical(expected))
          throw new JournalError(409);
        await tx`UPDATE erasure_journal.head SET epoch = ${epoch}, sealed = false, revision = revision + 1 WHERE singleton`;
      });
      return sign(await anchor());
    },
    async readRange(
      base: Pick<JournalHead, 'journalId' | 'sequence' | 'hash'>,
      expected: JournalHead,
    ) {
      if (
        base.journalId !== journalId ||
        !isSequence(base.sequence) ||
        !isDigest(base.hash)
      )
        throw new JournalError(400);
      const head = await anchor();
      if (!head.sealed || canonical(head) !== canonical(expected))
        throw new JournalError(409);
      const entries = await range(sql, base.sequence, head.sequence);
      const sealed = sign(head);
      verifyReplay(entries, base, sealed, keys.verification);
      if (canonical(await anchor()) !== canonical(head))
        throw new JournalError(409);
      return { entries, head: sealed };
    },
  };
}

export async function initializeJournalStores(
  sql: postgres.Sql,
  authority: postgres.Sql,
  journalId: string,
  epoch: string,
) {
  if (!isOperationId(journalId) || !isOperationId(epoch))
    throw new JournalError(400);
  await sql`INSERT INTO erasure_journal.head (journal_id, epoch, hash) VALUES (${journalId}, ${epoch}, ${JOURNAL_GENESIS})`;
  await authority`INSERT INTO erasure_authority.head (journal_id, epoch, sequence, revision, hash, sealed) VALUES (${journalId}, ${epoch}, 0, 0, ${JOURNAL_GENESIS}, false)`;
}
