import { expect, test } from 'bun:test';
import { type LegacyListBatch, legacyListHash } from './legacy';

test('pins the original numeric Starred hash independently of the new state protocol', () => {
  const listId = '0c339753-cb50-477c-843e-e641b414a060';
  const batch: LegacyListBatch = {
    clientId: 'a7a2e014-b64f-4487-9c92-71cd59fc0cf7',
    sequence: '9007199254740993',
    changes: [
      { op: 'add', episodeId: 101 },
      { op: 'remove', episodeId: 9007199254740991 },
    ],
  };
  expect(legacyListHash(listId, batch)).toBe(
    '5b10e23d1a64071a78f496b96c2bde9096314ac254607e841a9a28e5ad52e334',
  );
  expect(legacyListHash(listId, JSON.parse(JSON.stringify(batch)))).toBe(
    legacyListHash(listId, batch),
  );
});
