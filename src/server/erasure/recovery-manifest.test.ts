import { expect, test } from 'bun:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { loadMigrations } from '../../../scripts/migrations';
import {
  digest,
  entryHash,
  JOURNAL_GENESIS,
  JOURNAL_PAGE_LIMIT,
  type JournalEntry,
  type JournalHead,
  type ReplayCursor,
  signValue,
  verifyReplay,
} from './journal-contract';
import {
  CHECKPOINT_MAX_AGE_MS,
  migrationChainHash,
  type RecoveryManifest,
  type RecoveryPageReader,
  readVerifiedReplay,
  verifyCheckpointManifest,
} from './recovery-manifest';

const pair = generateKeyPairSync('ed25519');
const keys = new Map([['synthetic-recovery', pair.publicKey]]);
const signed = <T>(value: T) =>
  signValue(value, 'synthetic-recovery', pair.privateKey);
const now = new Date('2026-10-10T12:00:00.000Z');
const journalId = randomUUID();
const base = (): ReplayCursor => ({
  journalId,
  sequence: '0',
  hash: JOURNAL_GENESIS,
});
const manifest = (): RecoveryManifest => ({
  version: 1,
  purpose: 'account-recovery-checkpoint',
  artifactHash: digest('synthetic ciphertext'),
  schemaHash: migrationChainHash(loadMigrations()),
  createdAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + CHECKPOINT_MAX_AGE_MS).toISOString(),
  base: base(),
});
const expected = () => {
  const value = manifest();
  return {
    artifactHash: value.artifactHash,
    schemaHash: value.schemaHash,
    journalId,
    eligibleArtifacts: new Set([value.artifactHash]),
    now,
  };
};

function history(count = 5, start = base()) {
  const epoch = randomUUID();
  let cursor = { ...start };
  const entries = Array.from({ length: count }, () => {
    const value: JournalEntry = {
      journalId,
      epoch,
      sequence: String(BigInt(cursor.sequence) + 1n),
      previousHash: cursor.hash,
      publishedAt: now.toISOString(),
      payload: {
        version: 1,
        operationId: randomUUID(),
        accountId: 'synthetic-account',
        acceptedAt: now.toISOString(),
        action: 'erase_account',
      },
    };
    cursor = { journalId, sequence: value.sequence, hash: entryHash(value) };
    return signed(value);
  });
  const head = signed<JournalHead>({
    ...cursor,
    epoch,
    revision: String(BigInt(cursor.sequence) + 1n),
    sealed: true,
  });
  return { entries, head };
}

async function collect(
  reader: RecoveryPageReader,
  start: ReplayCursor,
  head: ReturnType<typeof history>['head'],
) {
  const result = [];
  for await (const page of readVerifiedReplay(reader, start, head, keys))
    result.push(page);
  return result;
}

test('checkpoint eligibility binds actual ciphertext, trusted schema, current inventory and journal base', () => {
  const value = manifest();
  const verified = verifyCheckpointManifest(signed(value), keys, expected());
  expect(verified).toEqual(value);
  expect(Object.isFrozen(verified)).toBe(true);
  expect(Object.isFrozen(verified.base)).toBe(true);
  value.base.sequence = '999';
  expect(verified.base.sequence).toBe('0');
  expect(() =>
    verifyCheckpointManifest(signed(manifest()), keys, {
      ...expected(),
      eligibleArtifacts: new Set(),
    }),
  ).toThrow();
  for (const field of ['artifactHash', 'schemaHash', 'journalId'] as const)
    expect(() =>
      verifyCheckpointManifest(signed(manifest()), keys, {
        ...expected(),
        [field]: digest('different'),
      }),
    ).toThrow();
});

test.each([
  'version',
  'purpose',
  'extra',
  'future',
  'expired',
  'extended',
  'backwards',
  'wrong-base',
  'numeric-sequence',
  'wrong-journal',
])('even a signed checkpoint is refused for %s', (failure) => {
  const value = manifest();
  if (failure === 'version') Reflect.set(value, 'version', 2);
  if (failure === 'purpose') Reflect.set(value, 'purpose', 'journal-entry');
  if (failure === 'extra')
    Reflect.set(value, 'email', 'synthetic@example.invalid');
  if (failure === 'future')
    value.createdAt = new Date(now.getTime() + 1).toISOString();
  if (failure === 'expired') value.expiresAt = now.toISOString();
  if (failure === 'extended')
    value.expiresAt = new Date(
      now.getTime() + CHECKPOINT_MAX_AGE_MS + 1,
    ).toISOString();
  if (failure === 'backwards')
    value.expiresAt = new Date(now.getTime() - 1).toISOString();
  if (failure === 'wrong-base') value.base.hash = digest('not genesis');
  if (failure === 'numeric-sequence') Reflect.set(value.base, 'sequence', 0);
  if (failure === 'wrong-journal') value.base.journalId = randomUUID();
  expect(() =>
    verifyCheckpointManifest(signed(value), keys, expected()),
  ).toThrow();
});

test('manifest signature and key custody cannot be replaced by an archived ready flag', () => {
  const value = signed(manifest());
  expect(() =>
    verifyCheckpointManifest(value, new Map(), expected()),
  ).toThrow();
  const wrong = generateKeyPairSync('ed25519');
  expect(() =>
    verifyCheckpointManifest(
      value,
      new Map([['synthetic-recovery', wrong.publicKey]]),
      expected(),
    ),
  ).toThrow();
  value.value.expiresAt = new Date(now.getTime() + 1000).toISOString();
  expect(() => verifyCheckpointManifest(value, keys, expected())).toThrow();
  expect(() =>
    verifyCheckpointManifest(signed({ ready: true }), keys, expected()),
  ).toThrow();
});

test('schema identity hashes the ordered trusted migration chain without omitting or changing entries', () => {
  const rows = loadMigrations();
  const last = rows.at(-1);
  if (!last) throw new Error('Missing migration chain');
  const hash = migrationChainHash(rows);
  expect(
    migrationChainHash(rows.map(({ name, checksum }) => ({ name, checksum }))),
  ).toBe(hash);
  expect(migrationChainHash(rows.slice(0, -1))).not.toBe(hash);
  expect(
    migrationChainHash(
      rows.map((row, i) =>
        i === 0 ? { ...row, checksum: digest('changed') } : row,
      ),
    ),
  ).not.toBe(hash);
  for (const invalid of [
    [],
    [...rows].reverse(),
    [...rows, last],
    [{ name: 'unexpected.sql', checksum: digest('x') }],
  ])
    expect(() => migrationChainHash(invalid)).toThrow();
});

test('verified replay advances by exact sequence/hash pages and does not call a partial page complete', async () => {
  const { entries, head } = history();
  const cursors: string[] = [];
  const pages = await collect(
    {
      async readRange(cursor, expectedHead, limit) {
        cursors.push(cursor.sequence);
        expect(expectedHead).toEqual(head.value);
        expect(limit).toBe(JOURNAL_PAGE_LIMIT);
        return {
          entries: entries
            .filter(
              (entry) => BigInt(entry.value.sequence) > BigInt(cursor.sequence),
            )
            .slice(0, 2),
          head,
        };
      },
    },
    base(),
    head,
  );
  expect(cursors).toEqual(['0', '2', '4']);
  expect(pages.map((page) => page.done)).toEqual([false, false, true]);
  expect(pages.at(-1)?.cursor.hash).toBe(head.value.hash);
  expect(() => verifyReplay(entries.slice(0, 2), base(), head, keys)).toThrow();
});

test.each([
  'gap',
  'empty',
  'tamper',
  'head-change',
  'overflow',
])('replay never yields a completion after %s evidence', async (failure) => {
  const { entries, head } = history();
  let calls = 0;
  let completed = false;
  const reader: RecoveryPageReader = {
    async readRange() {
      calls++;
      if (calls === 1) return { entries: entries.slice(0, 2), head };
      const next = structuredClone(entries.slice(2));
      if (failure === 'gap') next.shift();
      if (failure === 'empty') next.length = 0;
      if (failure === 'tamper') next[0].value.payload.accountId = 'changed';
      if (failure === 'overflow')
        return {
          entries: Array(JOURNAL_PAGE_LIMIT + 1).fill(entries[0]),
          head,
        };
      return {
        entries: next,
        head:
          failure === 'head-change'
            ? signed({ ...head.value, epoch: randomUUID(), revision: '7' })
            : head,
      };
    },
  };
  await expect(
    (async () => {
      for await (const page of readVerifiedReplay(reader, base(), head, keys))
        completed ||= page.done;
    })(),
  ).rejects.toThrow();
  expect(completed).toBe(false);
  expect(calls).toBe(2);
});

test('caller mutation of yielded cursors or source head cannot skip unconsumed evidence', async () => {
  const { entries, head } = history(3);
  const expectedHead = structuredClone(head);
  const seen: string[] = [];
  for await (const page of readVerifiedReplay(
    {
      async readRange(cursor) {
        seen.push(cursor.sequence);
        return {
          entries: entries
            .filter(
              (entry) => BigInt(entry.value.sequence) > BigInt(cursor.sequence),
            )
            .slice(0, 1),
          head: expectedHead,
        };
      },
    },
    base(),
    head,
    keys,
  )) {
    page.cursor.sequence = expectedHead.value.sequence;
    page.cursor.hash = expectedHead.value.hash;
    head.value.epoch = randomUUID();
  }
  expect(seen).toEqual(['0', '1', '2']);
});

test('a reader cannot move the verification cursor to hide an omitted suffix', async () => {
  const { head } = history();
  await expect(
    collect(
      {
        async readRange(cursor, expectedHead) {
          cursor.sequence = expectedHead.sequence;
          cursor.hash = expectedHead.hash;
          return { entries: [], head };
        },
      },
      base(),
      head,
    ),
  ).rejects.toThrow();
});

test('unsealed or malformed heads refuse before reader I/O; nonzero large cursors remain exact', async () => {
  const start = {
    journalId,
    sequence: '9007199254740993',
    hash: digest('trusted earlier prefix'),
  };
  const { entries, head } = history(1, start);
  let reads = 0;
  const reader = {
    async readRange() {
      reads++;
      return { entries, head };
    },
  };
  await expect(
    collect(reader, start, signed({ ...head.value, sealed: false })),
  ).rejects.toThrow();
  await expect(
    collect(reader, start, signed({ ...head.value, revision: '0' })),
  ).rejects.toThrow();
  expect(reads).toBe(0);
  const pages = await collect(reader, start, head);
  expect(pages[0].cursor.sequence).toBe('9007199254740994');
  expect(pages[0].done).toBe(true);
});
