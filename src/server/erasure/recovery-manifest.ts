import type { KeyObject } from 'node:crypto';
import {
  canonical,
  digest,
  isDigest,
  isInstant,
  isOperationId,
  isSequence,
  JOURNAL_GENESIS,
  JOURNAL_PAGE_LIMIT,
  type JournalEntry,
  JournalError,
  type JournalHead,
  type ReplayCursor,
  type Signed,
  verifyHead,
  verifyReplayPage,
  verifyValue,
} from './journal-contract';

export const CHECKPOINT_MAX_AGE_MS = 35 * 86_400_000;

export interface RecoveryManifest {
  version: 1;
  purpose: 'account-recovery-checkpoint';
  artifactHash: string;
  schemaHash: string;
  createdAt: string;
  expiresAt: string;
  base: ReplayCursor;
}

export function migrationChainHash(
  migrations: readonly { name: string; checksum: string }[],
) {
  if (
    !migrations.length ||
    migrations.some(
      (row, index) =>
        !/^\d{4}-[a-z0-9-]+\.sql$/.test(row.name) ||
        !isDigest(row.checksum) ||
        (index > 0 && migrations[index - 1].name >= row.name),
    )
  )
    throw new JournalError(503);
  return digest(
    canonical(migrations.map(({ name, checksum }) => ({ name, checksum }))),
  );
}

export function verifyCheckpointManifest(
  envelope: Signed<unknown>,
  keys: ReadonlyMap<string, KeyObject>,
  expected: {
    artifactHash: string;
    schemaHash: string;
    journalId: string;
    eligibleArtifacts: ReadonlySet<string>;
    now: Date;
  },
): RecoveryManifest {
  const value = verifyValue(envelope, keys);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new JournalError(503);
  const manifest = value as RecoveryManifest;
  const time = expected.now.getTime();
  if (
    Object.keys(manifest).sort().join(',') !==
      'artifactHash,base,createdAt,expiresAt,purpose,schemaHash,version' ||
    manifest.version !== 1 ||
    manifest.purpose !== 'account-recovery-checkpoint' ||
    !isDigest(manifest.artifactHash) ||
    manifest.artifactHash !== expected.artifactHash ||
    !isDigest(manifest.schemaHash) ||
    manifest.schemaHash !== expected.schemaHash ||
    !expected.eligibleArtifacts.has(manifest.artifactHash) ||
    !isInstant(manifest.createdAt) ||
    !isInstant(manifest.expiresAt) ||
    !Number.isFinite(time) ||
    Date.parse(manifest.createdAt) > time ||
    Date.parse(manifest.expiresAt) <= time ||
    Date.parse(manifest.expiresAt) <= Date.parse(manifest.createdAt) ||
    Date.parse(manifest.expiresAt) - Date.parse(manifest.createdAt) >
      CHECKPOINT_MAX_AGE_MS ||
    !manifest.base ||
    Object.keys(manifest.base).sort().join(',') !== 'hash,journalId,sequence' ||
    !isOperationId(manifest.base.journalId) ||
    manifest.base.journalId !== expected.journalId ||
    !isSequence(manifest.base.sequence) ||
    !isDigest(manifest.base.hash) ||
    (manifest.base.sequence === '0' && manifest.base.hash !== JOURNAL_GENESIS)
  )
    throw new JournalError(503);
  return Object.freeze({
    ...manifest,
    base: Object.freeze({ ...manifest.base }),
  });
}

export interface RecoveryPageReader {
  readRange(
    base: ReplayCursor,
    expected: JournalHead,
    limit: number,
  ): Promise<{
    entries: Signed<JournalEntry>[];
    head: Signed<JournalHead>;
  }>;
}

export async function* readVerifiedReplay(
  reader: RecoveryPageReader,
  base: ReplayCursor,
  sealed: Signed<JournalHead>,
  keys: ReadonlyMap<string, KeyObject>,
) {
  const expected = structuredClone(verifyHead(sealed, keys));
  if (
    !expected.sealed ||
    base.journalId !== expected.journalId ||
    !isSequence(base.sequence) ||
    !isDigest(base.hash) ||
    BigInt(base.sequence) > BigInt(expected.sequence) ||
    (base.sequence === '0' && base.hash !== JOURNAL_GENESIS)
  )
    throw new JournalError(503);
  let cursor = { ...base };
  for (;;) {
    const page = await reader.readRange(
      { ...cursor },
      { ...expected },
      JOURNAL_PAGE_LIMIT,
    );
    const verified = verifyReplayPage(page.entries, cursor, page.head, keys);
    if (canonical(verified.head) !== canonical(expected))
      throw new JournalError(503);
    cursor = { ...verified.cursor };
    yield { entries: page.entries, cursor: { ...cursor }, done: verified.done };
    if (verified.done) return;
  }
}
