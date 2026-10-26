import { describe, expect, test } from 'bun:test';
import { matchesReviewCode, reviewCodeDigest } from './review-credential';

const secret = 'synthetic-review-secret'.repeat(3);

describe('review login credentials', () => {
  test('binds leading-zero codes to the store and normalized email', () => {
    const expected = reviewCodeDigest(
      secret,
      'apple',
      'Review@example.invalid',
      '012345',
    );
    expect(expected).toBe(
      reviewCodeDigest(secret, 'apple', 'review@example.invalid', '012345'),
    );
    for (const supplied of [
      reviewCodeDigest(secret, 'google', 'review@example.invalid', '012345'),
      reviewCodeDigest(secret, 'apple', 'other@example.invalid', '012345'),
      reviewCodeDigest(secret, 'apple', 'review@example.invalid', '123456'),
      reviewCodeDigest(
        `${secret}changed`,
        'apple',
        'review@example.invalid',
        '012345',
      ),
      '',
      '00',
    ])
      expect(matchesReviewCode(expected, supplied)).toBe(false);
    expect(matchesReviewCode(expected, expected)).toBe(true);
  });

  test('rejects malformed credentials and unavailable protection keys', () => {
    for (const code of ['12345', '1234567', 'abcdef', '012345\n'])
      expect(() =>
        reviewCodeDigest(secret, 'apple', 'review@example.invalid', code),
      ).toThrow();
    expect(() =>
      reviewCodeDigest('short', 'apple', 'review@example.invalid', '012345'),
    ).toThrow();
  });
});
