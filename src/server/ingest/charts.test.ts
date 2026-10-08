import { describe, expect, mock, spyOn, test } from 'bun:test';
import { fetchTopFromItunes } from './charts';

const ids = [1513807137, 6806963519];
const chart = (values = ids.map(String)) => ({
  feed: {
    entry: values.map((id) => ({ id: { attributes: { 'im:id': id } } })),
  },
});
const podcast = (id: number, overrides = {}) => ({
  kind: 'podcast',
  collectionId: id,
  artistName: 'Author',
  collectionName: `Podcast ${id}`,
  feedUrl: `https://example.com/${id}/feed`,
  artworkUrl600: 'https://example.com/cover.jpg',
  artworkUrl100: 'https://example.com/thumbnail.jpg',
  collectionExplicitness: 'explicit',
  trackCount: 12,
  ...overrides,
});

function responses(...values: unknown[]) {
  let index = 0;
  return mock(async (_url: string, _init: RequestInit) =>
    Response.json(values[index++]),
  );
}

describe('Apple chart fetching', () => {
  test('preserves large IDs and source ranks when lookup results are reordered', async () => {
    const request = responses(chart(), {
      results: ids.toReversed().map((id) => podcast(id)),
    });
    const result = await fetchTopFromItunes('nl', request);
    expect(result.map(({ itunesId, rank }) => ({ itunesId, rank }))).toEqual([
      { itunesId: String(ids[0]), rank: 1 },
      { itunesId: String(ids[1]), rank: 2 },
    ]);
    const lookupUrl = new URL(request.mock.calls[1][0]);
    expect(lookupUrl.searchParams.get('country')).toBe('nl');
    expect(lookupUrl.searchParams.get('entity')).toBe('podcast');
    expect(lookupUrl.searchParams.get('id')).toBe(ids.join(','));
    expect(lookupUrl.searchParams.get('limit')).toBe('100');
  });

  test('preserves exact string provider IDs and refuses rounded numeric replies', async () => {
    const id = '9007199254740993';
    const request = responses(chart([id]), {
      results: [podcast(1, { collectionId: id })],
    });
    expect((await fetchTopFromItunes('us', request))[0].itunesId).toBe(id);
    expect(new URL(request.mock.calls[1][0]).searchParams.get('id')).toBe(id);
    const unsafe = responses(chart([id]), {
      results: [podcast(1, { collectionId: Number(id) })],
    });
    await expect(fetchTopFromItunes('us', unsafe)).rejects.toThrow(
      'no usable podcasts',
    );
  });

  test('filters unavailable feeds and unrelated lookup entries without inventing ranks', async () => {
    const request = responses(chart(), {
      results: [
        podcast(ids[0], { feedUrl: undefined }),
        podcast(ids[1]),
        podcast(123),
        podcast(ids[0], { kind: 'artist' }),
      ],
    });
    const result = await fetchTopFromItunes('nl', request);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(2);
  });

  test('normalizes optional author, artwork, and episode-count fields', async () => {
    const request = responses(chart(), {
      results: [
        podcast(ids[0], {
          artistName: undefined,
          artworkUrl600: undefined,
          trackCount: undefined,
        }),
      ],
    });
    const [result] = await fetchTopFromItunes('nl', request);
    expect(result.author).toBe('Unknown');
    expect(result.cover).toBe('https://example.com/thumbnail.jpg');
    expect(result.count).toBe(0);
  });

  test('rejects empty or malformed chart and lookup responses', async () => {
    for (const value of [null, {}, { feed: { entry: [] } }]) {
      await expect(fetchTopFromItunes('nl', responses(value))).rejects.toThrow(
        'chart',
      );
    }
    for (const value of [null, {}, { results: [] }]) {
      await expect(
        fetchTopFromItunes('nl', responses(chart(), value)),
      ).rejects.toThrow();
    }
  });

  test('rejects duplicate, non-integer, or unsafe chart IDs before lookup', async () => {
    for (const values of [
      ['0'],
      ['1.5'],
      ['bad'],
      ['9223372036854775808'],
      ['123', '123'],
    ]) {
      const request = responses(chart(values));
      await expect(fetchTopFromItunes('nl', request)).rejects.toThrow(
        'chart IDs',
      );
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  test('does not silently discard a listed podcast with broken required metadata', async () => {
    for (const overrides of [
      { collectionName: undefined },
      { artworkUrl600: undefined, artworkUrl100: undefined },
      { feedUrl: 'file:///feed.xml' },
    ]) {
      const request = responses(chart(), {
        results: [podcast(ids[0], overrides)],
      });
      await expect(fetchTopFromItunes('nl', request)).rejects.toThrow(
        'metadata',
      );
    }
  });

  test('deduplicates repeated lookup results', async () => {
    const request = responses(chart(), {
      results: [podcast(ids[0]), podcast(ids[0])],
    });
    expect(await fetchTopFromItunes('nl', request)).toHaveLength(1);
  });

  test('rejects contradictory Apple feed associations instead of selecting the last result', async () => {
    for (const feedUrl of ['https://example.com/different', undefined]) {
      const request = responses(chart(), {
        results: [podcast(ids[0]), podcast(ids[0], { feedUrl })],
      });
      await expect(fetchTopFromItunes('my', request)).rejects.toThrow(
        'ambiguous',
      );
    }
  });

  test('HTTP failures are reported rather than mistaken for empty charts', async () => {
    const failedChart = mock(async () => new Response(null, { status: 503 }));
    await expect(fetchTopFromItunes('nl', failedChart)).rejects.toThrow(
      'HTTP 503',
    );
    const failedLookup = mock(async (url: string) =>
      url.includes('/lookup')
        ? new Response(null, { status: 429 })
        : Response.json(chart()),
    );
    await expect(fetchTopFromItunes('nl', failedLookup)).rejects.toThrow(
      'HTTP 429',
    );
  });

  test('bounds both Apple requests with a timeout', async () => {
    const timeout = spyOn(AbortSignal, 'timeout');
    const request = responses(chart(), { results: [podcast(ids[0])] });
    try {
      await fetchTopFromItunes('nl', request);
      expect(timeout).toHaveBeenCalledTimes(2);
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(
        request.mock.calls.every(
          ([, init]) => init.signal instanceof AbortSignal,
        ),
      ).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });
});
