import { describe, expect, test } from 'bun:test';
import { en } from '@/messages';
import { getNestedValue, translateKey } from './shared';

describe('getNestedValue', () => {
  test('returns value for valid key', () => {
    expect(getNestedValue(en, 'common.appName')).toBe('Podcst');
  });

  test('returns path for invalid key', () => {
    expect(getNestedValue(en, 'invalid.key')).toBe('invalid.key');
  });
});

describe('translateKey', () => {
  test('returns simple translation without params', () => {
    const result = translateKey(en, 'common.appName');
    expect(result).toBe('Podcst');
  });

  test('replaces simple {param} placeholders', () => {
    const result = translateKey(en, 'auth.verifySubtitle', {
      email: 'test@example.com',
    });
    expect(result).toBe('We sent a code to test@example.com');
  });

  test('handles plural with count = 1', () => {
    const result = translateKey(en, 'account.subscriptionCount', {
      count: 1,
    });
    expect(result).toBe('1 subscription');
  });

  test('handles plural with count = 0', () => {
    const result = translateKey(en, 'account.subscriptionCount', {
      count: 0,
    });
    expect(result).toBe('0 subscriptions');
  });

  test('handles plural with count > 1', () => {
    const result = translateKey(en, 'account.subscriptionCount', {
      count: 5,
    });
    expect(result).toBe('5 subscriptions');
  });

  test('handles plural inside a sentence', () => {
    const result = translateKey(en, 'account.thisDeviceDescription', {
      count: 1,
    });
    expect(result).toBe('1 podcast is saved in this browser.');
    expect(result).not.toContain('{count, plural');
  });

  test('handles podcast.episodeCount with plural', () => {
    const result = translateKey(en, 'podcast.episodeCount', { count: 42 });
    expect(result).toBe('42 episodes');
  });
});
