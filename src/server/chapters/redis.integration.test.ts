import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  type ChapterCacheEntry,
  chapterCacheKey,
  FRESH_MS,
  fingerprint,
  LOCK_TTL_MS,
  MAX_CACHE_BYTES,
  RETENTION_MS,
} from './cache';
import { chapterRedisOptions, createRedisChapterCache } from './redis';
import { createChapterService } from './service';

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
    expect(await a.acquire(id, 'a')).toEqual({ acquired: true, entry: null });
    expect(await a.publish(id, 'a', entry, RETENTION_MS)).toBe(true);
    expect(await b.get(id)).toEqual(entry);
    expect(await first.pttl(id)).toBeGreaterThan(RETENTION_MS - 5000);
    expect(await first.pttl(id)).toBeLessThanOrEqual(RETENTION_MS);
    expect(await first.exists(`${id}:lock`)).toBe(0);
    await first.pexpire(id, 0);
    expect(await b.get(id)).toBeNull();
  });

  test('acquisition returns a result published after the initial miss in one round trip', async () => {
    const id = key();
    expect(await a.get(id)).toBeNull();
    await b.acquire(id, 'publisher');
    expect(await b.publish(id, 'publisher', entry, RETENTION_MS)).toBe(true);
    const commands = spyOn(first, 'sendCommand');
    try {
      expect(await a.acquire(id, 'reader')).toEqual({
        acquired: true,
        entry,
      });
      expect(commands).toHaveBeenCalledTimes(1);
    } finally {
      commands.mockRestore();
      await a.release(id, 'reader');
    }
  });

  test('a contender reads the latest entry without changing the active lease', async () => {
    const id = key();
    await a.acquire(id, 'publisher');
    await a.publish(id, 'publisher', entry, RETENTION_MS);
    await a.acquire(id, 'worker');
    expect(await b.acquire(id, 'contender')).toEqual({
      acquired: false,
      entry,
    });
    expect(await first.get(`${id}:lock`)).toBe('worker');
  });

  test('a cold service returns final chapters in three Redis commands', async () => {
    const episode = {
      id: '42',
      owner_user_id: null,
      file_url: `https://example.invalid/${randomUUID()}`,
      file_type: 'audio/mpeg',
      file_length: 1000,
      summary: '00:00 One<br>01:00 Two',
    };
    const id = chapterCacheKey(episode);
    keys.push(id);
    const service = createChapterService(async () => episode, {
      cache: a,
      now: () => 1000,
      schedule() {},
      fetchChapters: async () => ({
        status: 'modified',
        chapters: entry.chapters,
        validators: entry.validators,
      }),
    });
    const commands = spyOn(first, 'sendCommand');
    try {
      expect(await service('42', null)).toEqual({
        source: 'embedded',
        chapters: entry.chapters,
      });
      expect(commands).toHaveBeenCalledTimes(3);
    } finally {
      commands.mockRestore();
    }
    expect(await b.get(id)).toEqual(entry);
    expect(await first.exists(`${id}:lock`)).toBe(0);
  });

  test('invalid cache payloads do not conceal an acquired lease', async () => {
    const id = key();
    for (const raw of ['{malformed', ' '.repeat(MAX_CACHE_BYTES + 1)]) {
      await first.set(id, raw);
      expect(await a.acquire(id, 'worker')).toEqual({
        acquired: true,
        entry: null,
      });
      expect(await first.get(`${id}:lock`)).toBe('worker');
      await a.release(id, 'worker');
    }
  });

  test('atomically elects one owner and rejects stale release and publication after expiry', async () => {
    const id = key();
    const results = await Promise.all([a.acquire(id, 'a'), b.acquire(id, 'b')]);
    expect(results.filter(({ acquired }) => acquired)).toHaveLength(1);
    const owner = results[0].acquired ? 'a' : 'b';
    expect(await first.pttl(`${id}:lock`)).toBeGreaterThan(LOCK_TTL_MS - 5000);
    expect(await first.pttl(`${id}:lock`)).toBeLessThanOrEqual(LOCK_TTL_MS);
    await a.release(id, 'stranger');
    expect(await first.get(`${id}:lock`)).toBe(owner);
    await first.pexpire(`${id}:lock`, 0);
    expect(await b.acquire(id, 'replacement')).toEqual({
      acquired: true,
      entry: null,
    });
    expect(await a.publish(id, owner, entry, RETENTION_MS)).toBe(false);
    await a.release(id, owner);
    expect(await first.get(`${id}:lock`)).toBe('replacement');
    const newer = { ...entry, checkedAt: 2000 };
    expect(await b.publish(id, 'replacement', newer, RETENTION_MS)).toBe(true);
    expect(await a.get(id)).toEqual(newer);
  });

  test('deduplicates services through real Redis and performs weekly background renewal', async () => {
    const episode = {
      id: '42',
      owner_user_id: null,
      file_url: `https://example.invalid/${randomUUID()}`,
      file_type: 'audio/mpeg',
      file_length: 1000,
      summary: '00:00 One<br>01:00 Two',
    };
    const id = chapterCacheKey(episode);
    keys.push(id);
    let now = 1000;
    let fetched = 0;
    let started: () => void = () => {};
    let finish: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const jobs: (() => Promise<void>)[] = [];
    const options = {
      now: () => now,
      schedule: (work: () => Promise<void>) => {
        jobs.push(work);
      },
      fetchChapters: async () => {
        fetched++;
        started();
        await hold;
        return {
          status: 'modified' as const,
          chapters: entry.chapters,
          validators: {
            urlFingerprint: fingerprint(episode.file_url),
            etag: '"fixture"',
          },
        };
      },
    };
    const one = createChapterService(async () => episode, {
      ...options,
      cache: a,
    });
    const two = createChapterService(async () => episode, {
      ...options,
      cache: b,
    });
    const initial = one(episode.id, null);
    await running;
    expect((await two(episode.id, null))?.source).toBe('shownotes');
    expect(fetched).toBe(1);
    finish();
    await initial;
    expect((await two(episode.id, null))?.source).toBe('embedded');
    now += FRESH_MS;
    await Promise.all([one(episode.id, null), two(episode.id, null)]);
    expect(fetched).toBe(1);
    await Promise.all(jobs.splice(0).map((work) => work()));
    expect(fetched).toBe(2);
    expect((await a.get(id))?.checkedAt).toBe(now);
  });

  test('rejects malformed and oversized stored payloads without returning them', async () => {
    const id = key();
    await first.set(id, '{malformed');
    expect(await a.get(id)).toBeNull();
    await first.set(id, ' '.repeat(MAX_CACHE_BYTES + 1));
    expect(await a.get(id)).toBeNull();
  });
});
