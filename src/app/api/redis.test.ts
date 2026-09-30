import {
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { Redis } from 'ioredis';
import type { IPodcast, IShortUrl } from '@/types';

let cache: typeof import('./redis').cache;

beforeAll(async () => {
  const connect = spyOn(Redis.prototype, 'connect').mockResolvedValue(
    undefined,
  );
  try {
    ({ cache } = await import('./redis'));
  } finally {
    connect.mockRestore();
  }
});

const now = 1_800_000_000_000;
const podcast: IPodcast = {
  id: 1,
  title: 'The Daily',
  author: 'The New York Times',
  feed: 'https://example.com/daily.xml',
  cover: 'https://example.com/daily.jpg',
  thumbnail: 'https://example.com/daily-thumbnail.jpg',
  categories: [],
  explicit: 'notExplicit',
  count: 1,
};

afterEach(() => {
  mock.restore();
});

describe('Redis cache freshness', () => {
  test.each([
    3_601, 60_000, 3_600_000,
  ])('chart data remains cached after %i milliseconds', async (age) => {
    spyOn(Date, 'now').mockReturnValue(now);
    const get = spyOn(Redis.prototype, 'get').mockResolvedValue(
      JSON.stringify({ entity: [podcast], timestamp: now - age }),
    );
    expect(await cache.top(1, 'us')).toEqual({
      entity: [podcast],
      timestamp: now - age,
    });
    expect(get).toHaveBeenCalledWith('top/us');
  });

  test('chart data expires after one hour', async () => {
    spyOn(Date, 'now').mockReturnValue(now);
    spyOn(Redis.prototype, 'get').mockResolvedValue(
      JSON.stringify({ entity: [podcast], timestamp: now - 3_600_001 }),
    );
    expect(await cache.top(1, 'us')).toEqual({ entity: [], timestamp: 0 });
  });

  test('a missing cache entry is a cache miss', async () => {
    spyOn(Redis.prototype, 'get').mockResolvedValue(null);
    expect(await cache.top(1, 'us')).toEqual({ entity: [], timestamp: 0 });
  });

  test('short URLs remain permanent regardless of cache age', async () => {
    spyOn(Date, 'now').mockReturnValue(now);
    const shortUrl: IShortUrl = { feed: podcast.feed, guid: 'daily-episode' };
    spyOn(Redis.prototype, 'get').mockResolvedValue(
      JSON.stringify({ entity: shortUrl, timestamp: now - 3_600_001 }),
    );
    expect(await cache.getShortUrl('daily')).toEqual(shortUrl);
  });
});
