import { expect, test } from 'bun:test';
import fixtures from '../../contracts/feeds/fixtures.json';
import { FEED_LIMITS, feedValidator } from './feed-contract';

for (const fixture of fixtures) {
  test(`feed contract: ${fixture.name}`, () => {
    const validate = feedValidator(
      fixture.shape as Parameters<typeof feedValidator>[0],
    );
    expect(validate(fixture.value)).toBe(fixture.valid);
  });
}

test('refresh has one request shape, without the old response-mode switch', () => {
  const validate = feedValidator('refreshRequest');
  expect(validate({ podcastId: '9007199254740995' })).toBe(true);
  expect(validate({ podcastId: '1', onlyIfStale: true })).toBe(false);
  expect(validate({ podcastId: 1 })).toBe(false);
  expect(validate({ podcastId: '01' })).toBe(false);
  expect(FEED_LIMITS.imports.items).toBe(20);
  expect(FEED_LIMITS.refresh.leaseSeconds).toBe(60);
});
