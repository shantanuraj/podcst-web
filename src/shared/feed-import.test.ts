import { expect, test } from 'bun:test';
import { FEED_LIMITS } from './feed-contract';
import { feedImportBatches } from './feed-import';

const scope = {
  protocol: 1 as const,
  accountId: 'synthetic',
  generation: '17adbd84-d0e4-4e2d-ad9f-b084efee3211',
};

test('import batching preserves order and bounds encoded UTF-8, not character count', () => {
  const feeds = Array.from(
    { length: 45 },
    (_, i) => `https://example.invalid/${i}?token=${'音'.repeat(4000)}`,
  );
  const batches = feedImportBatches(scope, feeds);
  expect(batches.flat()).toEqual(feeds);
  expect(batches.length).toBeGreaterThan(3);
  for (const feedUrls of batches) {
    expect(feedUrls.length).toBeLessThanOrEqual(FEED_LIMITS.imports.items);
    expect(
      new TextEncoder().encode(JSON.stringify({ ...scope, feedUrls }))
        .byteLength,
    ).toBeLessThanOrEqual(FEED_LIMITS.bodyBytes);
  }
});

test('invalid inputs fail rather than being silently dropped from import batches', () => {
  expect(() => feedImportBatches(scope, [''])).toThrow();
  expect(() => feedImportBatches(scope, ['x'.repeat(4097)])).toThrow();
});
