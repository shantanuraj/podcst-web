import { expect, test } from 'bun:test';
import fixtures from '../../contracts/state/fixtures.json';
import {
  compareCanonicalIds,
  isCanonicalId,
  migrateStoredId,
} from './canonical-id';

test('checks the same canonical identity domain as the wire schema', () => {
  for (const vector of fixtures.scalars)
    expect(isCanonicalId(vector.value)).toBe(vector.id);
});

test('orders lock identities without rounding adjacent large IDs', () => {
  expect(
    ['9007199254740993', '10', '9007199254740992', '9'].sort(
      compareCanonicalIds,
    ),
  ).toEqual(['9', '10', '9007199254740992', '9007199254740993']);
});

test('converts only exact stored IDs and preserves unresolved source values', () => {
  for (const id of [1, 123, Number.MAX_SAFE_INTEGER])
    expect(migrateStoredId(id)).toEqual({ canonicalId: String(id) });
  for (const id of ['9007199254740993', '9223372036854775807'])
    expect(migrateStoredId(id)).toEqual({ canonicalId: id });
  for (const unresolved of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '01',
    '1e3',
    '',
    null,
    { guid: 'same' },
  ])
    expect(migrateStoredId(unresolved)).toEqual({ unresolved });
});
