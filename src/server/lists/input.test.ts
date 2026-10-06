import { describe, expect, test } from 'bun:test';
import type { ListBatch, ListChange } from '@/shared/lists';
import { encodeListCursor, parseListBatch, parseListCursor } from './input';

const listId = '0c339753-cb50-477c-843e-e641b414a060';
const valid: ListBatch = {
  clientId: 'A7A2E014-B64F-4487-9C92-71CD59FC0CF7',
  sequence: '1',
  changes: [{ op: 'add', episodeId: 123 }],
};

describe('list requests', () => {
  test('normalizes UUIDs and preserves decimal sequences exactly', () => {
    expect(parseListBatch(valid)).toEqual({
      ...valid,
      clientId: valid.clientId.toLowerCase(),
    });
    expect(
      parseListBatch({ ...valid, sequence: '9223372036854775807' })?.sequence,
    ).toBe('9223372036854775807');
  });

  test.each(
    [
      null,
      [],
      'batch',
      {},
      { ...valid, userId: 'other' },
      { ...valid, clientId: 'wrong' },
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
    '1e1',
    '9223372036854775808',
    1,
    null,
  ])('rejects invalid sequence %j', (sequence) => {
    expect(parseListBatch({ ...valid, sequence })).toBeNull();
  });

  test.each(
    [
      [],
      Array.from({ length: 101 }, () => valid.changes[0]),
      [{ op: 'toggle', episodeId: 123 }],
      [{ op: 'import', episodeId: 123 }],
      [{ op: 'add', episodeId: '123' }],
      [{ op: 'add', episodeId: 0 }],
      [{ op: 'add', episodeId: 1.5 }],
      [{ op: 'add', episodeId: Number.MAX_SAFE_INTEGER + 1 }],
      [{ op: 'add', episodeId: 123, addedAt: 1 }],
      [null],
    ].map((changes) => ({ changes })),
  )('rejects invalid changes %j', ({ changes }) => {
    expect(parseListBatch({ ...valid, changes })).toBeNull();
  });

  test('accepts both explicit actions up to the batch limit', () => {
    const changes = Array.from(
      { length: 100 },
      (_, i): ListChange => ({
        op: i % 2 ? 'add' : 'remove',
        episodeId: i + 1,
      }),
    );
    expect(parseListBatch({ ...valid, changes })?.changes).toEqual(changes);
  });
});

describe('list display cursors', () => {
  const cursor = { listId, addedAt: 1770000000123, episodeId: 123 };

  test('round-trips millisecond timestamps and binds the list', () => {
    const encoded = encodeListCursor(cursor);
    expect(parseListCursor(encoded, listId)).toEqual(cursor);
    expect(parseListCursor(encoded, valid.clientId)).toBeNull();
  });

  test.each([
    'not json',
    '***',
    '',
    'x'.repeat(513),
    Buffer.from('null').toString('base64url'),
  ])('rejects malformed cursors %j', (value) => {
    expect(parseListCursor(value, listId)).toBeNull();
  });

  test.each([
    { ...cursor, addedAt: 8.64e15 + 1 },
    { ...cursor, episodeId: -1 },
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
