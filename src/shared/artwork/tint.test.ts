import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { ArtworkTintCache } from './tint';

const tint = { light: '#b8c4c4', dark: '#3d4a4a' };
const source =
  'https://assets.podcst.app/?p=https%3A%2F%2Fexample.com%2Fa&w=160';

afterEach(() => mock.restore());

describe('artwork tint metadata', () => {
  test('uses anonymous CORS HEAD without reading or downloading an image body', async () => {
    const request = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        headers: {
          'X-Artwork-Tint-Light': '#B8C4C4',
          'X-Artwork-Tint-Dark': '#3d4a4a',
        },
      }),
    );
    expect(await new ArtworkTintCache().get(source)).toEqual(tint);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(source);
    expect(request.mock.calls[0][1]).toMatchObject({
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
    });
    expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('requires two valid CSS hex colours', async () => {
    const request = spyOn(globalThis, 'fetch');
    const cases: HeadersInit[] = [
      {},
      { 'X-Artwork-Tint-Light': '#b8c4c4' },
      { 'X-Artwork-Tint-Dark': '#3d4a4a' },
      { 'X-Artwork-Tint-Light': 'red', 'X-Artwork-Tint-Dark': '#3d4a4a' },
      { 'X-Artwork-Tint-Light': '#b8c4c4', 'X-Artwork-Tint-Dark': '#fff' },
      { 'X-Artwork-Tint-Light': '#b8c4c4', 'X-Artwork-Tint-Dark': 'url(evil)' },
    ];
    for (const headers of cases) {
      request.mockResolvedValue(new Response(null, { headers }));
      expect(await new ArtworkTintCache().get(source)).toBeNull();
    }
  });

  test('returns no tint for HTTP errors, CORS failures, redirects and timeouts', async () => {
    const request = spyOn(globalThis, 'fetch');
    for (const status of [304, 404, 429, 503]) {
      request.mockResolvedValue(
        new Response(null, {
          status,
          headers: {
            'X-Artwork-Tint-Light': tint.light,
            'X-Artwork-Tint-Dark': tint.dark,
          },
        }),
      );
      expect(await new ArtworkTintCache().get(source)).toBeNull();
    }
    for (const error of [
      new TypeError('Failed to fetch'),
      new DOMException('Timed out', 'TimeoutError'),
    ]) {
      request.mockRejectedValue(error);
      expect(await new ArtworkTintCache().get(source)).toBeNull();
    }
  });
});

describe('bounded artwork tint cache', () => {
  test('deduplicates pending requests and reuses both colours', async () => {
    const pending = Promise.withResolvers<typeof tint>();
    const load = mock(() => pending.promise);
    const cache = new ArtworkTintCache(load);
    const first = cache.get(source);
    const second = cache.get(source);
    expect(second).toBe(first);
    pending.resolve(tint);
    expect(await first).toEqual(tint);
    expect(await cache.get(source)).toEqual(tint);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('expires successful results after an hour and failures after a minute', async () => {
    let now = 0;
    const load = mock(async () => tint);
    const cache = new ArtworkTintCache(load, () => now);
    await cache.get(source);
    now = 3_599_999;
    expect(await cache.get(source)).toEqual(tint);
    expect(load).toHaveBeenCalledTimes(1);
    now++;
    load.mockRejectedValueOnce(new Error('Offline'));
    expect(await cache.get(source)).toBeNull();
    now += 59_999;
    expect(await cache.get(source)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    now++;
    expect(await cache.get(source)).toEqual(tint);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test('evicts the least recently used completed result at 64 entries', async () => {
    const load = mock(async () => tint);
    const cache = new ArtworkTintCache(load);
    for (let index = 0; index < 64; index++) await cache.get(String(index));
    await cache.get('0');
    await cache.get('64');
    await cache.get('0');
    expect(load).toHaveBeenCalledTimes(65);
    await cache.get('1');
    expect(load).toHaveBeenCalledTimes(66);
  });

  test('bounds pending work without evicting or duplicating active requests', async () => {
    const pending = Promise.withResolvers<typeof tint>();
    const load = mock(() => pending.promise);
    const cache = new ArtworkTintCache(load);
    const requests = Array.from({ length: 64 }, (_, index) =>
      cache.get(String(index)),
    );
    expect(await cache.get('overflow')).toBeNull();
    expect(cache.get('0')).toBe(requests[0]);
    expect(load).toHaveBeenCalledTimes(64);
    pending.resolve(tint);
    await Promise.all(requests);
    expect(await cache.get('overflow')).toEqual(tint);
    expect(load).toHaveBeenCalledTimes(65);
  });
});
