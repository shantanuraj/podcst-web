import { expect, mock, test } from 'bun:test';
import { MemoryChapterCache } from './__fixtures__/cache';
import {
  ABSENT_TTL_MS,
  type ChapterCache,
  chapterCacheKey,
  FAILURE_TTL_MS,
  FRESH_MS,
  fingerprint,
  type HttpValidators,
  LOCK_TTL_MS,
  RETENTION_MS,
} from './cache';
import type { ChapterEpisode } from './episode';
import type { ChapterFetchResult } from './http';
import { chapterResponse } from './response';
import {
  createChapterService,
  LOCAL_TTL_MS,
  MAX_IN_FLIGHT,
  MAX_LOCAL_ENTRIES,
} from './service';

const episode: ChapterEpisode = {
  id: 42,
  owner_user_id: null,
  file_url: 'https://media.example.invalid/synthetic.mp3?secret=token',
  file_length: 1000,
  file_type: 'audio/mpeg',
  summary: '00:00 Intro<br>01:00 Outro',
};
const chapters = [
  { title: 'Embedded', start: 0 },
  { title: 'Topic', start: 15.5 },
];
const metadata: ChapterFetchResult = {
  status: 'modified',
  chapters,
  validators: {
    urlFingerprint: fingerprint(episode.file_url ?? ''),
    etag: '"original"',
  },
};
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function fixture() {
  const clock = { value: 1_000_000 };
  const current = { ...episode };
  const now = () => clock.value;
  const cache = new MemoryChapterCache(now);
  const jobs: (() => Promise<void>)[] = [];
  const resolve = mock(
    async (id: number, _user: string | null) =>
      ({ ...current, id }) as ChapterEpisode | null,
  );
  const fetch = mock(
    async (
      _url: string,
      _validators?: HttpValidators,
      _signal?: AbortSignal,
    ): Promise<ChapterFetchResult> => metadata,
  );
  const instance = (
    options: Partial<Parameters<typeof createChapterService>[1]> = {},
  ) =>
    createChapterService(resolve, {
      cache,
      now,
      fetchChapters: fetch,
      schedule: (work) => {
        jobs.push(work);
      },
      ...options,
    });
  const flush = async () => {
    await Promise.all(jobs.splice(0).map((work) => work()));
  };
  return {
    clock,
    current,
    now,
    cache,
    jobs,
    resolve,
    fetch,
    instance,
    flush,
    key: () => chapterCacheKey(current),
  };
}

test('authorizes before every shared/local lookup and never shares private owners', async () => {
  const h = fixture();
  h.current.owner_user_id = 'owner';
  const service = h.instance();
  expect(await service(42, null)).toBeNull();
  expect(await service(42, 'stranger')).toBeNull();
  expect(h.cache.calls).toHaveLength(0);
  expect(h.fetch).not.toHaveBeenCalled();
  expect((await service(42, 'owner'))?.source).toBe('embedded');
  const accesses = h.cache.calls.length;
  expect(await service(42, 'stranger')).toBeNull();
  expect(h.cache.calls).toHaveLength(accesses);
  expect((await h.instance()(42, 'owner'))?.source).toBe('embedded');
  expect(h.fetch).toHaveBeenCalledTimes(1);
  h.current.owner_user_id = 'stranger';
  expect(await service(42, 'owner')).toBeNull();
  expect((await service(42, 'stranger'))?.source).toBe('embedded');
  h.current.owner_user_id = null;
  expect((await service(42, null))?.source).toBe('embedded');
  expect(h.fetch).toHaveBeenCalledTimes(3);
  expect(h.cache.entries.size).toBe(3);
  expect(h.resolve).toHaveBeenCalledTimes(8);
});

test('five-minute L1 hits authorize but avoid Redis and do not slide expiry', async () => {
  const h = fixture();
  const service = h.instance();
  expect(LOCAL_TTL_MS).toBe(5 * 60_000);
  await service(42, null);
  const accesses = h.cache.calls.length;
  const expires = h.cache.entries.get(h.key())?.expires;
  h.clock.value += LOCAL_TTL_MS - 1;
  expect((await service(42, null))?.chapters).toEqual(chapters);
  expect(h.cache.calls).toHaveLength(accesses);
  expect(h.resolve).toHaveBeenCalledTimes(2);
  h.clock.value++;
  expect((await service(42, null))?.chapters).toEqual(chapters);
  expect(h.cache.calls).toHaveLength(accesses + 1);
  expect(h.cache.calls.at(-1)?.operation).toBe('get');
  expect(h.cache.entries.get(h.key())?.expires).toBe(expires);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('Redis hits populate the L1 cache of a new instance', async () => {
  const h = fixture();
  await h.instance()(42, null);
  const service = h.instance();
  await service(42, null);
  const accesses = h.cache.calls.length;
  await service(42, null);
  expect(h.cache.calls).toHaveLength(accesses);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('warm L1 entries still trigger weekly revalidation at the freshness boundary', async () => {
  const h = fixture();
  const service = h.instance();
  await service(42, null);
  h.clock.value += FRESH_MS - 1;
  await service(42, null);
  const accesses = h.cache.calls.length;
  h.clock.value++;
  expect((await service(42, null))?.source).toBe('embedded');
  expect(h.cache.calls).toHaveLength(accesses);
  expect(h.jobs).toHaveLength(1);
  await h.flush();
  expect(h.fetch).toHaveBeenCalledTimes(2);
});

test("refresh workers bypass stale L1 entries and adopt another instance's fresh result", async () => {
  const h = fixture();
  const first = h.instance();
  const second = h.instance();
  await first(42, null);
  h.clock.value += FRESH_MS;
  await first(42, null);
  await second(42, null);
  const changed = {
    ...metadata,
    chapters: [
      { title: 'Changed', start: 0 },
      { title: 'Media', start: 100 },
    ],
  };
  h.fetch.mockResolvedValue(changed);
  await h.jobs.pop()?.();
  await h.flush();
  expect(h.fetch).toHaveBeenCalledTimes(2);
  const accesses = h.cache.calls.length;
  expect((await first(42, null))?.chapters).toEqual(changed.chapters);
  expect(h.cache.calls).toHaveLength(accesses);
});

test('L1 entries cannot extend retention when loaded just before six-month expiry', async () => {
  const h = fixture();
  const service = h.instance({
    schedule: () => {
      throw new Error('Synthetic scheduler unavailable');
    },
  });
  await service(42, null);
  h.clock.value += RETENTION_MS - 1;
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(1);
  h.clock.value++;
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(2);
  expect(h.fetch.mock.calls[1][1]).toBeUndefined();
});

test('shares fresh results across service instances without extending retention on reads', async () => {
  const h = fixture();
  await h.instance()(42, null);
  const expires = h.now() + RETENTION_MS;
  h.clock.value += FRESH_MS - 1;
  expect((await h.instance()(42, 'signed-in-public-reader'))?.chapters).toEqual(
    chapters,
  );
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.jobs).toHaveLength(0);
  expect(h.cache.entries.get(h.key())?.expires).toBe(expires);
});

test('serves stale chapters immediately and renews a 304 after one week in the background', async () => {
  const h = fixture();
  const service = h.instance();
  await service(42, null);
  h.clock.value += FRESH_MS;
  const response = deferred<ChapterFetchResult>();
  h.fetch.mockImplementation(() => response.promise);
  expect((await service(42, null))?.chapters).toEqual(chapters);
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.jobs).toHaveLength(1);
  const refresh = h.flush();
  await turn();
  expect(h.fetch.mock.calls[1][1]).toEqual(metadata.validators);
  response.resolve({ status: 'not-modified', validators: metadata.validators });
  await refresh;
  const saved = h.cache.entries.get(h.key());
  expect(saved?.entry).toMatchObject({
    kind: 'embedded',
    checkedAt: h.now(),
    chapters,
  });
  expect(saved?.expires).toBe(h.now() + RETENTION_MS);
  await service(42, null);
  expect(h.jobs).toHaveLength(0);
});

test('changed media at an unchanged URL replaces chapters and HTTP validators', async () => {
  const h = fixture();
  const service = h.instance();
  await service(42, null);
  h.clock.value += FRESH_MS;
  const replacement = {
    ...metadata,
    chapters: chapters.map((chapter) => ({
      ...chapter,
      start: chapter.start + 5,
    })),
    validators: { ...metadata.validators, etag: '"replacement"' },
  };
  h.fetch.mockResolvedValue(replacement);
  expect((await service(42, null))?.chapters).toEqual(chapters);
  await h.flush();
  expect((await service(42, null))?.chapters).toEqual(replacement.chapters);
  expect(h.cache.entries.get(h.key())?.entry).toMatchObject({
    validators: replacement.validators,
  });
});

test('expiry after six months performs an unconditional bounded fetch', async () => {
  const h = fixture();
  const service = h.instance();
  await service(42, null);
  h.clock.value += RETENTION_MS;
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(2);
  expect(h.fetch.mock.calls[1][1]).toBeUndefined();
  expect(h.jobs).toHaveLength(0);
});

test('enclosure changes invalidate identity while notes are always derived from the current row', async () => {
  const h = fixture();
  h.fetch.mockResolvedValue({ ...metadata, chapters: [] });
  const service = h.instance();
  expect((await service(42, null))?.source).toBe('shownotes');
  h.current.summary = '00:00 New title<br>02:00 New end';
  expect((await service(42, null))?.chapters[1]).toEqual({
    title: 'New end',
    start: 120,
  });
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.cache.entries.get(h.key())?.entry).toEqual({
    kind: 'absent',
    checkedAt: h.now(),
  });
  h.current.file_url = 'https://example.invalid/changed.mp3';
  await service(42, null);
  h.current.file_length = 2000;
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(3);
});

for (const status of ['absent', 'failure'] as const) {
  test(`${status} results use short TTLs, not six-month retention`, async () => {
    const h = fixture();
    h.fetch.mockResolvedValue(
      status === 'absent'
        ? { ...metadata, chapters: [] }
        : { status: 'failed' },
    );
    const service = h.instance();
    await service(42, null);
    const ttl = status === 'absent' ? ABSENT_TTL_MS : FAILURE_TTL_MS;
    expect(h.cache.entries.get(h.key())?.expires).toBe(h.now() + ttl);
    h.clock.value += ttl - 1;
    await service(42, null);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.clock.value++;
    await service(42, null);
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.jobs).toHaveLength(0);
  });
}

test('a successful refresh finding no chapters replaces stale data with a short negative entry', async () => {
  const h = fixture();
  const service = h.instance();
  await service(42, null);
  h.clock.value += FRESH_MS;
  h.fetch.mockResolvedValue({ ...metadata, chapters: [] });
  expect((await service(42, null))?.source).toBe('embedded');
  await h.flush();
  expect((await service(42, null))?.source).toBe('shownotes');
  expect(h.cache.entries.get(h.key())?.expires).toBe(h.now() + ABSENT_TTL_MS);
});

test('transient refresh failures preserve stale success without renewing retention and back off briefly', async () => {
  const h = fixture();
  const service = h.instance();
  const checkedAt = h.now();
  await service(42, null);
  h.clock.value += FRESH_MS;
  h.fetch.mockResolvedValue({ status: 'failed' });
  await service(42, null);
  await h.flush();
  expect(h.cache.entries.get(h.key())).toMatchObject({
    entry: { kind: 'embedded', checkedAt, retryAt: h.now() + FAILURE_TTL_MS },
    expires: checkedAt + RETENTION_MS,
  });
  await service(42, null);
  expect(h.jobs).toHaveLength(0);
  h.clock.value += FAILURE_TTL_MS;
  await service(42, null);
  expect(h.jobs).toHaveLength(1);
  await h.flush();
  h.clock.value = checkedAt + RETENTION_MS;
  expect((await service(42, null))?.source).toBe('shownotes');
  expect(h.cache.entries.get(h.key())?.entry.kind).toBe('failure');
});

test('same-instance requests share extraction but not show-note fallback', async () => {
  const h = fixture();
  const response = deferred<ChapterFetchResult>();
  h.fetch.mockImplementation(() => response.promise);
  const service = h.instance();
  const first = service(42, null);
  await turn();
  h.current.summary = '00:00 Changed<br>02:00 Notes';
  const second = service(42, null);
  await turn();
  expect(h.fetch).toHaveBeenCalledTimes(1);
  response.resolve({ ...metadata, chapters: [] });
  expect((await first)?.chapters[1].start).toBe(60);
  expect((await second)?.chapters[1].start).toBe(120);
});

test('cross-instance lock contention returns fallback instead of starting duplicate extraction', async () => {
  const h = fixture();
  const response = deferred<ChapterFetchResult>();
  h.fetch.mockImplementation(() => response.promise);
  const first = h.instance()(42, null);
  await turn();
  expect((await h.instance()(42, null))?.source).toBe('shownotes');
  expect(h.fetch).toHaveBeenCalledTimes(1);
  response.resolve(metadata);
  expect((await first)?.source).toBe('embedded');
  expect((await h.instance()(42, null))?.source).toBe('embedded');
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('cross-instance stale refreshes elect one worker and recheck freshness under the lock', async () => {
  const h = fixture();
  const first = h.instance();
  const second = h.instance();
  await first(42, null);
  h.clock.value += FRESH_MS;
  await Promise.all([first(42, null), second(42, null), first(42, null)]);
  expect(h.jobs).toHaveLength(2);
  await h.flush();
  expect(h.fetch).toHaveBeenCalledTimes(2);
});

for (const change of ['owner', 'url', 'deleted']) {
  test(`background jobs reauthorize before cache access after ${change} changes`, async () => {
    const h = fixture();
    h.current.owner_user_id = 'owner';
    const service = h.instance();
    await service(42, 'owner');
    h.clock.value += FRESH_MS;
    await service(42, 'owner');
    if (change === 'owner') h.current.owner_user_id = 'new-owner';
    if (change === 'url')
      h.current.file_url = 'https://example.invalid/replaced.mp3';
    if (change === 'deleted') h.resolve.mockResolvedValue(null);
    const calls = h.cache.calls.length;
    await h.flush();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.cache.calls).toHaveLength(calls);
  });
}

test('expired locks recover and late workers cannot overwrite or release a newer owner', async () => {
  const h = fixture();
  const abort = new AbortController();
  const response = deferred<ChapterFetchResult>();
  h.fetch.mockImplementation(() => response.promise);
  const old = h.instance({ deadline: () => abort.signal })(42, null);
  await turn();
  const original = h.cache.locks.get(h.key())?.token;
  abort.abort();
  expect((await old)?.source).toBe('shownotes');
  expect(h.fetch.mock.calls[0][2]?.aborted).toBe(true);
  h.clock.value += LOCK_TTL_MS;
  expect(await h.cache.acquire(h.key(), 'replacement')).toBe(true);
  response.resolve(metadata);
  await turn();
  expect(h.cache.locks.get(h.key())?.token).toBe('replacement');
  expect(h.cache.entries.has(h.key())).toBe(false);
  expect(original).not.toBe('replacement');
  h.clock.value += LOCK_TTL_MS;
  h.fetch.mockResolvedValue(metadata);
  expect((await h.instance()(42, null))?.source).toBe('embedded');
});

test('a slow worker whose lease expired cannot publish over a completed replacement', async () => {
  const h = fixture();
  const response = deferred<ChapterFetchResult>();
  h.fetch.mockImplementation(() => response.promise);
  const old = h.instance()(42, null);
  await turn();
  h.clock.value += LOCK_TTL_MS;
  const changed = {
    ...metadata,
    chapters: [
      { title: 'New', start: 0 },
      { title: 'Media', start: 99 },
    ],
  };
  h.fetch.mockResolvedValue(changed);
  await h.instance()(42, null);
  response.resolve(metadata);
  expect((await old)?.chapters).toEqual(changed.chapters);
  expect(h.cache.entries.get(h.key())?.entry).toMatchObject({
    chapters: changed.chapters,
  });
});

for (const failure of [
  'get',
  'acquire',
  'publish',
  'release',
  'all',
] as const) {
  test(`Redis ${failure} outages degrade to bounded extraction and current notes`, async () => {
    const h = fixture();
    const failures: (keyof ChapterCache)[] =
      failure === 'all' ? ['get', 'acquire', 'publish', 'release'] : [failure];
    for (const name of failures) h.cache.failures.add(name);
    const service = h.instance();
    expect((await service(42, null))?.source).toBe('embedded');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    h.current.owner_user_id = 'private-owner';
    const calls = h.cache.calls.length;
    expect(await service(42, null)).toBeNull();
    expect(h.cache.calls).toHaveLength(calls);
    h.fetch.mockResolvedValue({ status: 'failed' });
    expect((await service(42, 'private-owner'))?.source).toBe('shownotes');
  });
}

test('partial Redis write outages back off failed refreshes without extending stale retention', async () => {
  const h = fixture();
  const service = h.instance();
  const expires = h.now() + RETENTION_MS;
  await service(42, null);
  h.clock.value += FRESH_MS;
  h.cache.failures.add('publish');
  h.fetch.mockResolvedValue({ status: 'failed' });
  await service(42, null);
  await h.flush();
  expect((await service(42, null))?.source).toBe('embedded');
  expect(h.jobs).toHaveLength(0);
  expect(h.cache.entries.get(h.key())?.expires).toBe(expires);
  h.clock.value += FAILURE_TTL_MS;
  await service(42, null);
  expect(h.jobs).toHaveLength(1);
  await h.flush();
});

test('L1 results have bounded size and lifetime during outages and recovery fills Redis', async () => {
  const h = fixture();
  h.cache.failures.add('get');
  h.cache.failures.add('acquire');
  const service = h.instance();
  await service(42, null);
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(1);
  h.clock.value += LOCAL_TTL_MS;
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(2);
  for (let id = 100; id < 100 + MAX_LOCAL_ENTRIES; id++)
    await service(id, null);
  await service(42, null);
  expect(h.fetch).toHaveBeenCalledTimes(MAX_LOCAL_ENTRIES + 3);
  h.cache.failures.clear();
  h.clock.value += LOCAL_TTL_MS;
  await service(42, null);
  expect(h.cache.entries.get(h.key())?.entry.kind).toBe('embedded');
});

test('bounds active and scheduled work and tolerates scheduler failures', async () => {
  const h = fixture();
  const response = deferred<ChapterFetchResult>();
  h.fetch.mockImplementation(() => response.promise);
  const service = h.instance();
  const pending = Array.from({ length: MAX_IN_FLIGHT }, (_, index) =>
    service(index + 1, null),
  );
  await turn();
  expect((await service(100, null))?.source).toBe('shownotes');
  expect(h.fetch).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
  response.resolve(metadata);
  await Promise.all(pending);
  h.clock.value += FRESH_MS;
  for (let id = 1; id <= MAX_IN_FLIGHT; id++) await service(id, null);
  expect(h.jobs).toHaveLength(MAX_IN_FLIGHT);
  const broken = h.instance({
    schedule: () => {
      throw new Error('No background context');
    },
  });
  expect((await broken(1, null))?.source).toBe('embedded');
  await h.flush();
});

test('background deadlines also bound stalled authorization and disregard late results', async () => {
  const h = fixture();
  await h.instance()(42, null);
  h.clock.value += FRESH_MS;
  const abort = new AbortController();
  const service = h.instance({ deadline: () => abort.signal });
  await service(42, null);
  const authorization = deferred<ChapterEpisode | null>();
  h.resolve.mockImplementation(() => authorization.promise);
  const refresh = h.flush();
  await turn();
  abort.abort();
  await refresh;
  const accesses = h.cache.calls.length;
  authorization.resolve(h.current);
  await turn();
  expect(h.cache.calls).toHaveLength(accesses);
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('an aborted queued background job never fetches even if scheduled later', async () => {
  const h = fixture();
  await h.instance()(42, null);
  h.clock.value += FRESH_MS;
  const abort = new AbortController();
  const service = h.instance({ deadline: () => abort.signal });
  await service(42, null);
  abort.abort();
  await h.flush();
  expect(h.fetch).toHaveBeenCalledTimes(1);
});

test('responses expose no validators or URLs and retain private/no-store for every status', async () => {
  const h = fixture();
  const service = h.instance();
  for (const id of [
    'https://media.example.invalid/a.mp3',
    '-1',
    '0',
    '1.2',
    '1x',
    '9007199254740992',
  ])
    expect((await chapterResponse(id, null, service)).status).toBe(400);
  expect(h.resolve).not.toHaveBeenCalled();
  const response = await chapterResponse('42', null, service);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(await response.json()).toEqual({ source: 'embedded', chapters });
  expect((await chapterResponse('42', null, async () => null)).status).toBe(
    404,
  );
  const failure = await chapterResponse('42', null, async () => {
    throw new Error(episode.file_url ?? '');
  });
  expect(failure.status).toBe(503);
  expect(await failure.text()).not.toContain('secret');
});
