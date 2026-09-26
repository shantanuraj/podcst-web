import { describe, expect, test } from 'bun:test';
import {
  getPollInterval,
  getRetryInterval,
  isRefreshDue,
  type PollState,
} from './feed-schedule';

const now = Date.parse('2026-09-26T22:00:00Z');
const state = (overrides: Partial<PollState> = {}): PollState => ({
  last_polled_at: new Date(now - 2 * 3600_000),
  next_poll_at: new Date(now + 22 * 3600_000),
  failures: 0,
  is_followed: false,
  ...overrides,
});

describe('poll intervals', () => {
  test('interprets every configured interval as seconds', () => {
    expect(getPollInterval(3600)).toBe(3600);
    expect(getPollInterval(7200)).toBe(7200);
    expect(getPollInterval(43200)).toBe(43200);
    expect(getPollInterval(172800)).toBe(172800);
  });

  test('defaults to daily and never schedules more than hourly', () => {
    expect(getPollInterval(null)).toBe(86400);
    expect(getPollInterval(0)).toBe(86400);
    expect(getPollInterval(1)).toBe(3600);
  });

  test('followed feeds are hourly regardless of configured frequency', () => {
    expect(getPollInterval(null, true)).toBe(3600);
    expect(getPollInterval(604800, true)).toBe(3600);
  });

  test('backs failures off exponentially with a seven-day cap', () => {
    expect(getRetryInterval(1)).toBe(7200);
    expect(getRetryInterval(2)).toBe(14400);
    expect(getRetryInterval(5)).toBe(115200);
    expect(getRetryInterval(20)).toBe(604800);
  });
});

describe('refresh eligibility', () => {
  test('opening a feed refreshes only after fifteen minutes', () => {
    expect(
      isRefreshDue(
        state({ last_polled_at: new Date(now - 899_999) }),
        'stale',
        now,
      ),
    ).toBe(false);
    expect(
      isRefreshDue(
        state({ last_polled_at: new Date(now - 900_000) }),
        'stale',
        now,
      ),
    ).toBe(true);
  });

  test('followed feeds become due before their old daily schedule', () => {
    expect(isRefreshDue(state({ is_followed: true }), 'scheduled', now)).toBe(
      true,
    );
    expect(isRefreshDue(state(), 'scheduled', now)).toBe(false);
    expect(
      isRefreshDue(
        state({ is_followed: true, last_polled_at: new Date(now - 3599_999) }),
        'scheduled',
        now,
      ),
    ).toBe(false);
  });

  test('all refresh modes respect failure backoff', () => {
    for (const mode of ['scheduled', 'stale', 'rebuild'] as const) {
      expect(
        isRefreshDue(state({ is_followed: true, failures: 1 }), mode, now),
      ).toBe(false);
      expect(
        isRefreshDue(
          state({ failures: 1, next_poll_at: new Date(now) }),
          mode,
          now,
        ),
      ).toBe(true);
    }
  });

  test('unpolled feeds can refresh immediately', () => {
    expect(
      isRefreshDue(
        state({ last_polled_at: null, next_poll_at: null }),
        'stale',
        now,
      ),
    ).toBe(true);
  });

  test('rebuilds bypass freshness but not backoff', () => {
    const fresh = state({ last_polled_at: new Date(now) });
    expect(isRefreshDue(fresh, 'stale', now)).toBe(false);
    expect(isRefreshDue(fresh, 'rebuild', now)).toBe(true);
  });
});
