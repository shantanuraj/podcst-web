import { createHash } from 'node:crypto';
import {
  type Chapter,
  normalizeChapterTitle,
  validTimeline,
} from '@/shared/chapters';
import { dependencies } from '../../../package.json';
import type { ChapterEpisode } from './episode';
import { MAX_CHAPTERS } from './mp3';

export const CACHE_VERSION = `2:music-metadata:${dependencies['music-metadata']}`;
export const RETENTION_MS = 180 * 24 * 60 * 60_000;
export const FRESH_MS = 7 * 24 * 60 * 60_000;
export const ABSENT_TTL_MS = 60 * 60_000;
export const FAILURE_TTL_MS = 60_000;
export const WORK_TIMEOUT_MS = 12_000;
export const LOCK_TTL_MS = WORK_TIMEOUT_MS + 2000;
export const MAX_CACHE_BYTES = 2 * 1024 * 1024;

export interface HttpValidators {
  urlFingerprint: string;
  etag?: string;
  lastModified?: string;
}

export type ChapterCacheEntry =
  | {
      kind: 'embedded';
      chapters: Chapter[];
      checkedAt: number;
      validators: HttpValidators;
      retryAt?: number;
    }
  | {
      kind: 'absent' | 'failure';
      checkedAt: number;
    };

export interface ChapterCache {
  get(key: string): Promise<ChapterCacheEntry | null>;
  acquire(key: string, token: string): Promise<boolean>;
  publish(
    key: string,
    token: string,
    entry: ChapterCacheEntry,
    ttl: number,
  ): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
}

export const fingerprint = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function chapterCacheKey(
  episode: ChapterEpisode,
  version = CACHE_VERSION,
) {
  const identity = [
    version,
    episode.owner_user_id,
    String(episode.id),
    fingerprint(episode.file_url ?? ''),
    episode.file_type,
    String(episode.file_length ?? ''),
  ];
  return `chapters:{${fingerprint(JSON.stringify(identity))}}`;
}

export function expiresAt(entry: ChapterCacheEntry) {
  return (
    entry.checkedAt +
    (entry.kind === 'embedded'
      ? RETENTION_MS
      : entry.kind === 'absent'
        ? ABSENT_TTL_MS
        : FAILURE_TTL_MS)
  );
}

export function usableEntry(entry: ChapterCacheEntry | null, now: number) {
  return entry && entry.checkedAt <= now + 60_000 && expiresAt(entry) > now
    ? entry
    : null;
}

export function needsRefresh(entry: ChapterCacheEntry, now: number) {
  return (
    entry.kind === 'embedded' &&
    entry.checkedAt + FRESH_MS <= now &&
    (!entry.retryAt ||
      entry.retryAt <= now ||
      entry.retryAt > now + FAILURE_TTL_MS)
  );
}

export function validEtag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 1024 &&
    /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value)
  );
}

export function validLastModified(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 64 &&
    new Date(value).toUTCString() === value &&
    Number.isFinite(Date.parse(value))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseCacheEntry(raw: string): ChapterCacheEntry | null {
  try {
    if (Buffer.byteLength(raw) > MAX_CACHE_BYTES) return null;
    const entry: unknown = JSON.parse(raw);
    if (
      !record(entry) ||
      typeof entry.checkedAt !== 'number' ||
      !Number.isSafeInteger(entry.checkedAt) ||
      entry.checkedAt < 0
    )
      return null;
    const { checkedAt } = entry;
    if (entry.kind === 'absent' || entry.kind === 'failure')
      return { kind: entry.kind, checkedAt };
    if (
      entry.kind !== 'embedded' ||
      !Array.isArray(entry.chapters) ||
      entry.chapters.length > MAX_CHAPTERS
    )
      return null;
    const chapters: Chapter[] = [];
    for (const chapter of entry.chapters) {
      if (
        !record(chapter) ||
        typeof chapter.title !== 'string' ||
        normalizeChapterTitle(chapter.title) !== chapter.title ||
        typeof chapter.start !== 'number'
      )
        return null;
      chapters.push({ title: chapter.title, start: chapter.start });
    }
    if (!validTimeline(chapters)) return null;
    const validators = entry.validators;
    if (
      !record(validators) ||
      typeof validators.urlFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(validators.urlFingerprint) ||
      (validators.etag !== undefined && !validEtag(validators.etag)) ||
      (validators.lastModified !== undefined &&
        !validLastModified(validators.lastModified))
    )
      return null;
    if (
      entry.retryAt !== undefined &&
      (typeof entry.retryAt !== 'number' ||
        !Number.isSafeInteger(entry.retryAt) ||
        entry.retryAt < 0)
    )
      return null;
    return {
      kind: 'embedded',
      chapters,
      checkedAt,
      validators: {
        urlFingerprint: validators.urlFingerprint,
        ...(validEtag(validators.etag) ? { etag: validators.etag } : {}),
        ...(validLastModified(validators.lastModified)
          ? { lastModified: validators.lastModified }
          : {}),
      },
      ...(typeof entry.retryAt === 'number' ? { retryAt: entry.retryAt } : {}),
    };
  } catch {
    return null;
  }
}
