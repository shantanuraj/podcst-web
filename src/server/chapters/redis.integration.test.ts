import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  type ChapterCacheEntry,
  fingerprint,
  LOCK_TTL_MS,
  MAX_CACHE_BYTES,
  RETENTION_MS,
} from './cache';
import { chapterRedisOptions, createRedisChapterCache } from './redis';

const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('shared chapter cache with Redis', () => {
  let first: Redis;
  let second: Redis;
  let a: ReturnType<typeof createRedisChapterCache>;
  let b: ReturnType<typeof createRedisChapterCache>;
  const keys: string[] = [];
  const key = () => {
    const value = `chapters:{${fingerprint(randomUUID())}}`;
    keys.push(value);
    return value;
  };
  const entry: ChapterCacheEntry = {
    kind: 'embedded',
    checkedAt: 1000,
    chapters: [
      { start: 0, title: 'Opening' },
      { start: 15, title: 'Topic' },
    ],
    validators: {
      urlFingerprint: fingerprint('https://example.invalid/media'),
      etag: '"v1"',
    },
  };

  beforeAll(() => {
    if (!url) throw new Error('TEST_REDIS_URL required');
    first = new Redis(url, chapterRedisOptions);
    second = new Redis(url, chapterRedisOptions);
    a = createRedisChapterCache(first);
    b = createRedisChapterCache(second);
  });
  afterAll(async () => {
    if (keys.length && first?.status === 'ready')
      await first.del(...keys.flatMap((key) => [key, `${key}:lock`]));
    first?.disconnect();
    second?.disconnect();
  });

  test('shares entries across clients and applies actual Redis retention TTLs', async () => {
    const id = key();
    expect(await a.get(id)).toBeNull();
    expect(await a.acquire(id, 'a')).toBe(true);
    expect(await a.publish(id, 'a', entry, RETENTION_MS)).toBe(true);
    expect(await b.get(id)).toEqual(entry);
    expect(await first.pttl(id)).toBeGreaterThan(RETENTION_MS - 5000);
    expect(await first.pttl(id)).toBeLessThanOrEqual(RETENTION_MS);
    expect(await first.exists(`${id}:lock`)).toBe(0);
    await first.pexpire(id, 0);
    expect(await b.get(id)).toBeNull();
  });

  test('atomically elects one owner and rejects stale release and publication after expiry', async () => {
    const id = key();
    const results = await Promise.all([a.acquire(id, 'a'), b.acquire(id, 'b')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const owner = results[0] ? 'a' : 'b';
    expect(await first.pttl(`${id}:lock`)).toBeGreaterThan(LOCK_TTL_MS - 5000);
    expect(await first.pttl(`${id}:lock`)).toBeLessThanOrEqual(LOCK_TTL_MS);
    await a.release(id, 'stranger');
    expect(await first.get(`${id}:lock`)).toBe(owner);
    await first.pexpire(`${id}:lock`, 0);
    expect(await b.acquire(id, 'replacement')).toBe(true);
    expect(await a.publish(id, owner, entry, RETENTION_MS)).toBe(false);
    await a.release(id, owner);
    expect(await first.get(`${id}:lock`)).toBe('replacement');
    const newer = { ...entry, checkedAt: 2000 };
    expect(await b.publish(id, 'replacement', newer, RETENTION_MS)).toBe(true);
    expect(await a.get(id)).toEqual(newer);
  });

  test('rejects malformed and oversized stored payloads without returning them', async () => {
    const id = key();
    await first.set(id, '{malformed');
    expect(await a.get(id)).toBeNull();
    await first.set(id, ' '.repeat(MAX_CACHE_BYTES + 1));
    expect(await a.get(id)).toBeNull();
  });
});
