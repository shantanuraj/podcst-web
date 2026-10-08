import { expect, test } from 'bun:test';
import {
  ABSENT_TTL_MS,
  type ChapterCacheEntry,
  chapterCacheKey,
  expiresAt,
  FAILURE_TTL_MS,
  FRESH_MS,
  fingerprint,
  MAX_CACHE_BYTES,
  needsRefresh,
  parseCacheEntry,
  RETENTION_MS,
  usableEntry,
} from './cache';
import type { ChapterEpisode } from './episode';

const episode: ChapterEpisode = {
  id: '42',
  owner_user_id: 'owner',
  file_url: 'https://example.invalid/private?secret=token',
  file_length: 42,
  file_type: 'audio/mpeg',
  summary: 'Notes',
};
const entry: ChapterCacheEntry = {
  kind: 'embedded',
  checkedAt: 1000,
  chapters: [
    { start: 0, title: 'First' },
    { start: 10, title: 'Second' },
  ],
  validators: {
    urlFingerprint: fingerprint(episode.file_url ?? ''),
    etag: '"v1"',
    lastModified: 'Wed, 01 Oct 2025 00:00:00 GMT',
  },
};

test('cache identity includes owner, episode, enclosure and decoder/schema version but not notes', () => {
  const key = chapterCacheKey(episode);
  expect(key).toMatch(/^chapters:\{[a-f0-9]{64}\}$/);
  expect(key).not.toContain('secret');
  expect(key).not.toContain('owner');
  for (const change of [
    { id: '43' },
    { owner_user_id: null },
    { owner_user_id: 'other' },
    { file_url: `${episode.file_url}&revision=2` },
    { file_length: 43 },
    { file_type: 'audio/mp4' },
  ])
    expect(chapterCacheKey({ ...episode, ...change })).not.toBe(key);
  expect(chapterCacheKey(episode, 'future-parser')).not.toBe(key);
  expect(chapterCacheKey({ ...episode, summary: 'Changed notes' })).toBe(key);
  expect(chapterCacheKey({ ...episode, file_length: '42' })).toBe(key);
  expect(chapterCacheKey({ ...episode, owner_user_id: 'null' })).not.toBe(
    chapterCacheKey({ ...episode, owner_user_id: null }),
  );
});

test('separates six-month retention, weekly freshness and short negative TTLs', () => {
  expect(RETENTION_MS).toBe(180 * 86_400_000);
  expect(FRESH_MS).toBe(7 * 86_400_000);
  expect(needsRefresh(entry, 1000 + FRESH_MS - 1)).toBe(false);
  expect(needsRefresh(entry, 1000 + FRESH_MS)).toBe(true);
  expect(usableEntry(entry, 1000 + RETENTION_MS - 1)).toEqual(entry);
  expect(usableEntry(entry, 1000 + RETENTION_MS)).toBeNull();
  expect(usableEntry({ ...entry, checkedAt: 1_000_000 }, 0)).toBeNull();
  expect(expiresAt({ kind: 'absent', checkedAt: 1000 })).toBe(
    1000 + ABSENT_TTL_MS,
  );
  expect(expiresAt({ kind: 'failure', checkedAt: 1000 })).toBe(
    1000 + FAILURE_TTL_MS,
  );
  expect(
    needsRefresh({ ...entry, retryAt: FRESH_MS + 2000 }, FRESH_MS + 1000),
  ).toBe(false);
  expect(
    needsRefresh({ ...entry, retryAt: FRESH_MS + 2000 }, FRESH_MS + 2000),
  ).toBe(true);
});

test('validates shared payloads before serving them', () => {
  expect(parseCacheEntry(JSON.stringify(entry))).toEqual(entry);
  expect(
    parseCacheEntry(
      JSON.stringify({
        kind: 'absent',
        checkedAt: 1000,
        summary: 'Never retained',
      }),
    ),
  ).toEqual({ kind: 'absent', checkedAt: 1000 });
  for (const value of [
    null,
    [],
    {},
    { ...entry, checkedAt: -1 },
    { ...entry, retryAt: Infinity },
    { ...entry, validators: { etag: '"missing fingerprint"' } },
    { ...entry, validators: { ...entry.validators, etag: 'unsafe\r\nHeader' } },
    {
      ...entry,
      validators: { ...entry.validators, lastModified: 'not a date' },
    },
    { ...entry, chapters: [{ title: 'Only one', start: 0 }] },
    {
      ...entry,
      chapters: entry.chapters.map((chapter) => ({ ...chapter, start: 0 })),
    },
    {
      ...entry,
      chapters: entry.chapters.map((chapter) => ({
        ...chapter,
        title: 'x'.repeat(301),
      })),
    },
  ])
    expect(parseCacheEntry(JSON.stringify(value))).toBeNull();
  expect(parseCacheEntry('not JSON')).toBeNull();
  expect(parseCacheEntry(' '.repeat(MAX_CACHE_BYTES + 1))).toBeNull();
});
