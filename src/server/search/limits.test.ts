import { expect, test } from 'bun:test';
import { createSearchLimiter, readSearchPolicy } from './limits';

const secret = 'synthetic-search-budget-secret-32-bytes';
const policy = { sourcePerMinute: 3, globalPerMinute: 5 };

test('requires explicit positive integer search budgets', () => {
  expect(
    readSearchPolicy({
      SEARCH_SOURCE_PER_MINUTE: '3',
      SEARCH_GLOBAL_PER_MINUTE: '5',
    }),
  ).toEqual(policy);
  for (const value of [
    undefined,
    '',
    '0',
    '-1',
    '1.5',
    '3junk',
    'Infinity',
    '9007199254740992',
  ]) {
    for (const field of [
      'SEARCH_SOURCE_PER_MINUTE',
      'SEARCH_GLOBAL_PER_MINUTE',
    ]) {
      expect(() =>
        readSearchPolicy({
          SEARCH_SOURCE_PER_MINUTE: '3',
          SEARCH_GLOBAL_PER_MINUTE: '5',
          [field]: value,
        }),
      ).toThrow('Search unavailable');
    }
  }
});

test('unavailable or malformed Redis state cannot admit search', async () => {
  for (const result of [null, '0', undefined, NaN, -1, 0.5, 61]) {
    const limit = createSearchLimiter(
      { eval: async () => result } as never,
      secret,
      policy,
    );
    await expect(limit('192.0.2.1')).rejects.toMatchObject({ status: 503 });
  }
  const limit = createSearchLimiter(
    {
      eval: async () => {
        throw new Error('redis credentials');
      },
    } as never,
    secret,
    policy,
  );
  await expect(limit('192.0.2.1')).rejects.toMatchObject({
    status: 503,
    message: 'Search unavailable',
  });
  expect(() => createSearchLimiter({} as never, 'short', policy)).toThrow(
    'Search unavailable',
  );
});
