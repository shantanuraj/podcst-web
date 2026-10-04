import { expect, test } from 'bun:test';
import type { ChapterEpisode } from './episode';
import { chapterResponse } from './response';
import {
  CHAPTER_TTL_MS,
  createChapterService,
  FALLBACK_TTL_MS,
  MAX_CACHE_ENTRIES,
  MAX_IN_FLIGHT,
} from './service';

const episode: ChapterEpisode = {
  id: 42,
  owner_user_id: null,
  file_url: 'https://media.example.invalid/synthetic.mp3?token=secret',
  file_length: 1000,
  file_type: 'audio/mpeg',
  summary: '00:00 Intro<br>01:00 Outro',
};
const embedded = [
  { title: 'Embedded', start: 0 },
  { title: 'Topic', start: 15.5 },
];

test('authorizes every request before fetching, deduplicating or serving cached private data', async () => {
  let owner: string | null = 'owner';
  let authorized = 0;
  let fetched = 0;
  const service = createChapterService(
    async (_, user) => {
      authorized++;
      return owner === null || owner === user
        ? { ...episode, owner_user_id: owner }
        : null;
    },
    async () => {
      fetched++;
      return embedded;
    },
  );
  expect(await service(42, null)).toBeNull();
  expect(await service(42, 'stranger')).toBeNull();
  expect(fetched).toBe(0);
  expect((await service(42, 'owner'))?.source).toBe('embedded');
  expect((await service(42, 'owner'))?.source).toBe('embedded');
  expect(fetched).toBe(1);
  expect(await service(42, 'stranger')).toBeNull();
  owner = 'stranger';
  expect(await service(42, 'owner')).toBeNull();
  expect((await service(42, 'stranger'))?.source).toBe('embedded');
  expect(fetched).toBe(2);
  owner = null;
  expect((await service(42, null))?.source).toBe('embedded');
  expect(fetched).toBe(3);
  expect(authorized).toBe(8);
});

test('deduplicates concurrent authorized requests and expires successes even for unchanged URLs', async () => {
  let now = 0;
  let fetched = 0;
  let finish: (value: typeof embedded) => void = () => {};
  const service = createChapterService(
    async () => episode,
    async () => {
      fetched++;
      if (fetched === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return embedded;
    },
    () => now,
  );
  const first = service(42, null);
  const second = service(42, null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetched).toBe(1);
  finish(embedded);
  expect(await first).toEqual(await second);
  now = CHAPTER_TTL_MS - 1;
  await service(42, null);
  expect(fetched).toBe(1);
  now++;
  await service(42, null);
  expect(fetched).toBe(2);
});

test('keys cache by enclosure metadata and show notes, not just episode ID', async () => {
  let current = { ...episode };
  let fetched = 0;
  const service = createChapterService(
    async () => current,
    async () => {
      fetched++;
      return [];
    },
  );
  await service(42, null);
  current = {
    ...current,
    file_url: 'https://media.example.invalid/replaced.mp3',
  };
  await service(42, null);
  current = { ...current, file_length: 2000 };
  await service(42, null);
  current = { ...current, summary: '00:00 New<br>02:00 Notes' };
  expect((await service(42, null))?.chapters[1].start).toBe(120);
  expect(fetched).toBe(4);
});

test('failures use show notes and short negative caching, never fail playback', async () => {
  let now = 0;
  let fetched = 0;
  const service = createChapterService(
    async () => episode,
    async () => {
      fetched++;
      throw new Error('private URL must not escape');
    },
    () => now,
  );
  const result = await service(42, null);
  expect(result).toEqual({
    source: 'shownotes',
    chapters: [
      { title: 'Intro', start: 0 },
      { title: 'Outro', start: 60 },
    ],
  });
  await service(42, null);
  expect(fetched).toBe(1);
  now = FALLBACK_TTL_MS;
  await service(42, null);
  expect(fetched).toBe(2);
  expect(
    await createChapterService(
      async () => ({ ...episode, summary: null }),
      async () => [],
    )(42, null),
  ).toEqual({ chapters: [], source: 'none' });
});

test('bounds cache and concurrent work', async () => {
  let fetched = 0;
  const resolve = async (id: number) => ({ ...episode, id });
  const service = createChapterService(resolve, async () => {
    fetched++;
    return embedded;
  });
  for (let id = 1; id <= MAX_CACHE_ENTRIES + 1; id++) await service(id, null);
  await service(1, null);
  expect(fetched).toBe(MAX_CACHE_ENTRIES + 2);
  const finish: ((value: typeof embedded) => void)[] = [];
  const saturated = createChapterService(
    resolve,
    () => new Promise((resolve) => finish.push(resolve)),
  );
  const pending = Array.from({ length: MAX_IN_FLIGHT }, (_, id) =>
    saturated(id, null),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((await saturated(MAX_IN_FLIGHT, null))?.source).toBe('shownotes');
  expect(finish).toHaveLength(MAX_IN_FLIGHT);
  for (const resolve of finish) resolve(embedded);
  await Promise.all(pending);
});

test('endpoint accepts only database IDs and returns private/no-store without enclosure URLs', async () => {
  let calls = 0;
  const service = createChapterService(
    async () => {
      calls++;
      return episode;
    },
    async () => embedded,
  );
  for (const id of [
    'https://media.example.invalid/a.mp3',
    '-1',
    '0',
    '1.2',
    '1x',
    '9007199254740992',
  ])
    expect((await chapterResponse(id, null, service)).status).toBe(400);
  expect(calls).toBe(0);
  const response = await chapterResponse('42', null, service);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(await response.text()).not.toContain('secret');
  expect((await chapterResponse('42', null, async () => null)).status).toBe(
    404,
  );
  const failed = await chapterResponse('42', null, async () => {
    throw new Error(episode.file_url ?? '');
  });
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('secret');
});
