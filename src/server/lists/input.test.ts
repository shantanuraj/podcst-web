import { describe, expect, test } from 'bun:test';
import type { ListBatch } from '@/shared/lists';
import {
  encodeListCursor,
  parseLegacyListBatch,
  parseListBatch,
  parseListCursor,
  parseListMigration,
} from './input';

const scope = {
  protocol: 1 as const,
  accountId: 'owner',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};
const batch: ListBatch = {
  ...scope,
  clientId: 'a7a2e014-b64f-4487-9c92-71cd59fc0cf7',
  sequence: '1',
  changes: [{ op: 'add', episodeId: '123' }],
};

describe('list requests', () => {
  test('preserves canonical IDs and decimal sequences exactly', () => {
    const value: ListBatch = {
      ...batch,
      sequence: '9007199254740993',
      changes: [{ op: 'add', episodeId: '9223372036854775807' }],
    };
    expect(parseListBatch(value)).toEqual(value);
  });
  test.each(
    [
      null,
      [],
      'batch',
      {},
      { ...batch, userId: 'other' },
      { ...batch, clientId: 'wrong' },
      { ...batch, clientId: batch.clientId.toUpperCase() },
      { ...batch, protocol: 0 },
      { ...batch, accountId: '' },
    ].map((value) => ({ value })),
  )('rejects invalid envelopes: %j', ({ value }) => {
    expect(parseListBatch(value)).toBeNull();
  });
  test.each([
    '0',
    '-1',
    '01',
    '1.0',
    ' 1',
    '1\n',
    '1e1',
    '9223372036854775808',
    1,
    null,
  ])('rejects invalid sequence %j', (sequence) => {
    expect(parseListBatch({ ...batch, sequence })).toBeNull();
  });
  test.each(
    [
      [],
      Array(101).fill(batch.changes[0]),
      [{ op: 'toggle', episodeId: '123' }],
      [{ op: 'import', episodeId: '123' }],
      [{ op: 'add', episodeId: 123 }],
      [{ op: 'add', episodeId: '0' }],
      [{ op: 'add', episodeId: '1.5' }],
      [{ op: 'add', episodeId: '9223372036854775808' }],
      [{ op: 'add', episodeId: '123', addedAt: 1 }],
      [null],
    ].map((changes) => ({ changes })),
  )('rejects invalid desired actions: %j', ({ changes }) => {
    expect(parseListBatch({ ...batch, changes })).toBeNull();
  });
  test('accepts ordered actions through the batch bound', () => {
    const value: ListBatch = {
      ...batch,
      changes: Array.from({ length: 100 }, (_, i) => ({
        op: i % 2 ? 'remove' : 'add',
        episodeId: String(i + 1),
      })),
    };
    expect(parseListBatch(value)).toEqual(value);
  });
  test('keeps numeric legacy requests separate and refuses unsafe conversions', () => {
    const legacy = {
      clientId: batch.clientId,
      sequence: batch.sequence,
      changes: [{ op: 'add' as const, episodeId: 123 }],
    };
    expect(parseListBatch(legacy)).toBeNull();
    expect(parseLegacyListBatch(legacy)).toEqual(legacy);
    expect(parseListMigration({ ...scope, batch: legacy })).toEqual({
      scope,
      batch: legacy,
    });
    expect(
      parseLegacyListBatch({
        ...legacy,
        changes: [{ op: 'add', episodeId: '123' }],
      }),
    ).toBeNull();
    expect(
      parseLegacyListBatch({
        ...legacy,
        changes: [{ op: 'add', episodeId: 9007199254740992 }],
      }),
    ).toBeNull();
    expect(
      parseListMigration({ ...scope, batch: legacy, extra: true }),
    ).toBeNull();
  });
});

describe('list display cursors', () => {
  const listId = '0c339753-cb50-477c-843e-e641b414a060';
  const cursor = {
    listId,
    addedAt: 1770000000123,
    episodeId: '9007199254740993',
  };
  test('round-trips exact IDs and milliseconds and binds the list', () => {
    const encoded = encodeListCursor(cursor);
    expect(parseListCursor(encoded, listId)).toEqual(cursor);
    expect(parseListCursor(encoded, batch.clientId)).toBeNull();
  });
  test.each([
    'not json',
    '***',
    '',
    'x'.repeat(513),
    Buffer.from('null').toString('base64url'),
  ])('rejects malformed cursor %j', (value) => {
    expect(parseListCursor(value, listId)).toBeNull();
  });
  test.each([
    { ...cursor, addedAt: 8640000000000001 },
    { ...cursor, addedAt: 1.5 },
    { ...cursor, episodeId: '-1' },
    { ...cursor, episodeId: 123 },
    { ...cursor, addedAt: '1770000000123' },
    { ...cursor, extra: true },
  ])('rejects invalid cursor fields %j', (value) => {
    expect(
      parseListCursor(
        Buffer.from(JSON.stringify(value)).toString('base64url'),
        listId,
      ),
    ).toBeNull();
  });
});
