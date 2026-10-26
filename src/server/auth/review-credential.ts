import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError } from './error';
import { isCode, isEmail } from './http';

export type ReviewStore = 'apple' | 'google';

export const normalizeEmailIdentity = (email: string) =>
  email.trim().toLowerCase();

export function reviewCodeDigest(
  secret: string,
  store: ReviewStore,
  email: string,
  code: string,
) {
  if (
    Buffer.byteLength(secret) < 32 ||
    !['apple', 'google'].includes(store) ||
    !isEmail(email) ||
    !isCode(code)
  )
    throw new AuthError(503, 'Authentication unavailable');
  return createHmac('sha256', secret)
    .update(
      JSON.stringify([
        'podcst:review-login:1',
        store,
        normalizeEmailIdentity(email),
        code,
      ]),
    )
    .digest('hex');
}

export function matchesReviewCode(expected: string, supplied: string) {
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(supplied, 'hex');
  return (
    left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
  );
}
