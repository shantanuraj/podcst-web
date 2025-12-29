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
    const result = translateKey(en, 'settings.exportLibraryCount', {
      count: 1,
    });
    expect(result).toBe('1 podcast in your library');
  });

  test('handles plural with count = 0', () => {
    const result = translateKey(en, 'settings.exportLibraryCount', {
      count: 0,
    });
    expect(result).toBe('0 podcasts in your library');
  });

  test('handles plural with count > 1', () => {
    const result = translateKey(en, 'settings.exportLibraryCount', {
      count: 5,
    });
    expect(result).toBe('5 podcasts in your library');
  });

  test('handles plural in profile.syncDescription', () => {
    const result = translateKey(en, 'profile.syncDescription', { count: 1 });
    expect(result).toContain('1 podcast');
    expect(result).not.toContain('{count, plural');
  });

  test('handles podcast.episodeCount with plural', () => {
    const result = translateKey(en, 'podcast.episodeCount', { count: 42 });
    expect(result).toBe('42 episodes');
  });
});
