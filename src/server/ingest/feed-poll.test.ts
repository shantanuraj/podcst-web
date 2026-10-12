import { describe, expect, test } from 'bun:test';
import { BATCH_ABORT_MIN_ATTEMPTS, shouldAbortPollBatch } from './feed-poll';

describe('poll batch circuit breaker', () => {
  test('waits for a meaningful sample and requires a majority of transient failures', () => {
    expect(shouldAbortPollBatch(BATCH_ABORT_MIN_ATTEMPTS - 1, 49)).toBe(false);
    expect(shouldAbortPollBatch(BATCH_ABORT_MIN_ATTEMPTS, 25)).toBe(false);
    expect(shouldAbortPollBatch(BATCH_ABORT_MIN_ATTEMPTS, 26)).toBe(true);
  });
});
