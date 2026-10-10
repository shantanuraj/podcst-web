import { createHash, type KeyObject, sign, verify } from 'node:crypto';
import { isAccountOperationId } from '@/shared/account-erasure';

export type ErasurePayload = {
  version: 1;
  operationId: string;
  accountId: string;
  acceptedAt: string;
} & (
  | { action: 'erase_account' }
  | { action: 'revoke_passkey'; credentialId: string }
);

export interface JournalHead {
  journalId: string;
  epoch: string;
  sequence: string;
  revision: string;
  hash: string;
  sealed: boolean;
}

export interface JournalEntry {
  journalId: string;
  epoch: string;
  sequence: string;
  previousHash: string;
  publishedAt: string;
  payload: ErasurePayload;
}

export interface Signed<T> {
  keyId: string;
  value: T;
  signature: string;
}

export interface ReceiptRegistration {
  digest: string;
  operationId: string;
  expiresAt: string;
}

export interface JournalClient {
  publish(
    epoch: string,
    payload: ErasurePayload,
  ): Promise<Signed<JournalEntry>>;
  lookup(
    operationId: string,
    payloadHash: string,
  ): Promise<Signed<JournalEntry> | null>;
  registerReceipt(receipt: ReceiptRegistration): Promise<void>;
  resolveReceipt(digest: string): Promise<{
    operationId: string;
    entry: Signed<JournalEntry> | null;
  } | null>;
}

export const ERASURE_PROOF_MS = 5 * 60_000;
export const ERASURE_RETRY_SECONDS = 5;
export const RECEIPT_LIFETIME_MS = 7 * 86_400_000;
export const JOURNAL_GENESIS = '0'.repeat(64);
export const JOURNAL_PAGE_LIMIT = 256;
export type ReplayCursor = Pick<JournalHead, 'journalId' | 'sequence' | 'hash'>;
export const isOperationId = (value: unknown): value is string =>
  isAccountOperationId(value) && value === value.toLowerCase();
export const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isIdentity = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const isInstant = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export const isSequence = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9]\d{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

export class JournalError extends Error {
  constructor(
    readonly status: 400 | 403 | 409 | 503,
    message = 'Recovery evidence unavailable',
  ) {
    super(message);
  }
}

export function parsePayload(value: unknown): ErasurePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new JournalError(400);
  const p = value as Record<string, unknown>;
  const fields = [
    'version',
    'operationId',
    'accountId',
    'acceptedAt',
    'action',
  ];
  if (p.action === 'revoke_passkey') fields.push('credentialId');
  if (
    p.version !== 1 ||
    !isOperationId(p.operationId) ||
    !isIdentity(p.accountId) ||
    !isInstant(p.acceptedAt) ||
    !['erase_account', 'revoke_passkey'].includes(String(p.action)) ||
    (p.action === 'revoke_passkey' && !isIdentity(p.credentialId)) ||
    Object.keys(p).length !== fields.length ||
    fields.some((key) => !(key in p))
  )
    throw new JournalError(400);
  return {
    version: 1,
    operationId: p.operationId,
    accountId: p.accountId as string,
    acceptedAt: p.acceptedAt,
    ...(p.action === 'erase_account'
      ? { action: 'erase_account' as const }
      : {
          action: 'revoke_passkey' as const,
          credentialId: p.credentialId as string,
        }),
  };
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const payloadHash = (value: ErasurePayload) =>
  digest(canonical(parsePayload(value)));
export const entryHash = (value: JournalEntry) => digest(canonical(value));

export function signValue<T>(
  value: T,
  keyId: string,
  key: KeyObject,
): Signed<T> {
  return {
    keyId,
    value,
    signature: sign(
      null,
      Buffer.from(canonical({ keyId, value })),
      key,
    ).toString('base64url'),
  };
}

export function verifyValue<T>(
  envelope: Signed<T>,
  keys: ReadonlyMap<string, KeyObject>,
): T {
  try {
    const key = keys.get(envelope.keyId);
    if (
      !key ||
      Object.keys(envelope).sort().join(',') !== 'keyId,signature,value' ||
      typeof envelope.signature !== 'string' ||
      envelope.signature.length !== 86 ||
      !verify(
        null,
        Buffer.from(
          canonical({ keyId: envelope.keyId, value: envelope.value }),
        ),
        key,
        Buffer.from(envelope.signature, 'base64url'),
      )
    )
      throw new Error();
    return envelope.value;
  } catch {
    throw new JournalError(503);
  }
}

export function verifyEntry(
  envelope: Signed<JournalEntry>,
  keys: ReadonlyMap<string, KeyObject>,
  journalId: string,
) {
  const e = verifyValue(envelope, keys);
  if (
    Object.keys(e).sort().join(',') !==
      'epoch,journalId,payload,previousHash,publishedAt,sequence' ||
    e.journalId !== journalId ||
    !isOperationId(e.epoch) ||
    !isSequence(e.sequence) ||
    e.sequence === '0' ||
    !isDigest(e.previousHash) ||
    !isInstant(e.publishedAt)
  )
    throw new JournalError(503);
  return { ...e, payload: parsePayload(e.payload) };
}

export function verifyHead(
  envelope: Signed<JournalHead>,
  keys: ReadonlyMap<string, KeyObject>,
) {
  const head = verifyValue(envelope, keys);
  if (
    !head ||
    typeof head !== 'object' ||
    Object.keys(head).sort().join(',') !==
      'epoch,hash,journalId,revision,sealed,sequence' ||
    typeof head.sealed !== 'boolean' ||
    !isOperationId(head.journalId) ||
    !isSequence(head.sequence) ||
    !isSequence(head.revision) ||
    !isDigest(head.hash) ||
    !isOperationId(head.epoch) ||
    BigInt(head.revision) < BigInt(head.sequence) ||
    (head.sequence === '0' && head.hash !== JOURNAL_GENESIS)
  )
    throw new JournalError(503);
  return head;
}

export function verifyReplayPage(
  entries: Signed<JournalEntry>[],
  base: ReplayCursor,
  sealed: Signed<JournalHead>,
  keys: ReadonlyMap<string, KeyObject>,
) {
  const head = verifyHead(sealed, keys);
  if (
    !Array.isArray(entries) ||
    entries.length > JOURNAL_PAGE_LIMIT ||
    head.sealed !== true ||
    head.journalId !== base.journalId ||
    !isSequence(base.sequence) ||
    !isDigest(base.hash) ||
    BigInt(head.sequence) < BigInt(base.sequence) ||
    (base.sequence === '0' && base.hash !== JOURNAL_GENESIS) ||
    (!entries.length && head.sequence !== base.sequence)
  )
    throw new JournalError(503);
  let sequence = BigInt(base.sequence);
  let hash = base.hash;
  const operations = new Set<string>();
  for (const signed of entries) {
    const entry = verifyEntry(signed, keys, head.journalId);
    if (
      BigInt(entry.sequence) !== ++sequence ||
      sequence > BigInt(head.sequence) ||
      entry.previousHash !== hash ||
      operations.has(entry.payload.operationId)
    )
      throw new JournalError(503);
    operations.add(entry.payload.operationId);
    hash = entryHash(entry);
  }
  const done = String(sequence) === head.sequence;
  if (done && hash !== head.hash) throw new JournalError(503);
  return {
    head,
    cursor: { journalId: head.journalId, sequence: String(sequence), hash },
    done,
  };
}

export function verifyReplay(
  entries: Signed<JournalEntry>[],
  base: ReplayCursor,
  sealed: Signed<JournalHead>,
  keys: ReadonlyMap<string, KeyObject>,
) {
  const verified = verifyReplayPage(entries, base, sealed, keys);
  if (!verified.done) throw new JournalError(503);
  return verified.head;
}
