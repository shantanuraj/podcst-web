import { expect, test } from 'bun:test';
import { validateCatalogue } from './catalogue';

test('wire catalogue IDs are exact strings while categories, counts and positions remain numbers', () => {
  expect(() =>
    validateCatalogue({
      id: '9223372036854775807',
      feed: 'https://fixture.invalid',
      itunes_id: '9007199254740993',
      genre: { id: 2 },
      count: 10,
      episodes: [
        {
          id: '9007199254740994',
          podcastId: '9223372036854775807',
          file: {},
          duration: 95,
        },
      ],
    }),
  ).not.toThrow();
  expect(() => validateCatalogue({ id: 301 })).toThrow();
  expect(() => validateCatalogue({ id: '301' })).not.toThrow();
  for (const value of [12, 9007199254740992, '01', '9223372036854775808'])
    expect(() =>
      validateCatalogue({ episodeId: value, position: 95 }),
    ).toThrow();
});
