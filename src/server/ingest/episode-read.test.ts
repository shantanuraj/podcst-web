import { expect, test } from 'bun:test';
import { needsRebuild } from './episode-read';

test('rebuild when zero content rows for a podcast that has identity rows', () => {
  expect(needsRebuild({ identityCount: 12, contentCount: 0 })).toBe(true);
});
test('no rebuild when content present', () => {
  expect(needsRebuild({ identityCount: 12, contentCount: 12 })).toBe(false);
});
test('no rebuild when podcast has no episodes at all', () => {
  expect(needsRebuild({ identityCount: 0, contentCount: 0 })).toBe(false);
});
