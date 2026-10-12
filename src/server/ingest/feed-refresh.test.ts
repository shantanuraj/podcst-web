import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { installFeedTransportFixture } from '../../../scripts/fixtures/feed-transport';
import { FeedFetchError } from './feed-errors';
import { fetchFeed } from './feed-refresh';

installFeedTransportFixture();

const xml = readFileSync(
  new URL('./__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);
const previous = {
  etag: '"old"',
  lastModified: 'Sat, 26 Sep 2026 03:44:00 GMT',
  hash: createHash('sha256').update(xml).digest('hex'),
};
let handle: (request: Request) => Response;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) => handle(request),
});

beforeEach(() => {
  handle = () => new Response(xml);
});
afterAll(() => server.stop(true));

describe('RSS fetching', () => {
  test('fetches and parses new episodes', async () => {
    const result = await fetchFeed(server.url.href);
    expect(result.status).toBe('updated');
    if (result.status !== 'updated') throw new Error('Expected feed data');
    expect(result.data.episodes[0].title).toBe('NoSleep Podcast - S25E06');
    expect(result.hash).toBe(previous.hash);
  });

  test('uses HTTP validators and preserves metadata on a 304', async () => {
    handle = (request) => {
      expect(request.headers.get('if-none-match')).toBe(previous.etag);
      expect(request.headers.get('if-modified-since')).toBe(
        previous.lastModified,
      );
      return new Response(null, { status: 304 });
    };
    expect(await fetchFeed(server.url.href, previous)).toEqual({
      status: 'not_modified',
      ...previous,
    });
  });

  test('unchanged bodies still update HTTP validators', async () => {
    handle = () => new Response(xml, { headers: { etag: '"new"' } });
    expect(await fetchFeed(server.url.href, previous)).toEqual({
      status: 'not_modified',
      etag: '"new"',
      lastModified: null,
      hash: previous.hash,
    });
  });

  test('unconditional rebuilds do not send validators or skip matching bodies', async () => {
    handle = (request) => {
      expect(request.headers.has('if-none-match')).toBe(false);
      expect(request.headers.has('if-modified-since')).toBe(false);
      return new Response(xml);
    };
    expect((await fetchFeed(server.url.href)).status).toBe('updated');
  });

  test('classifies HTTP failures and malformed feeds without retaining bodies', async () => {
    for (const [status, kind] of [
      [400, 'http_client'],
      [401, 'http_auth'],
      [404, 'http_gone'],
      [408, 'timeout'],
      [425, 'http_rate_limit'],
      [429, 'http_rate_limit'],
      [503, 'http_server'],
    ] as const) {
      handle = () =>
        new Response(null, {
          status,
          headers: status === 429 ? { 'Retry-After': '60' } : undefined,
        });
      try {
        await fetchFeed(server.url.href);
        throw new Error('accepted');
      } catch (error) {
        expect(error).toBeInstanceOf(FeedFetchError);
        expect(error).toMatchObject({ kind, status });
        if (status === 429)
          expect((error as FeedFetchError).retryAfterSeconds).toBe(60);
      }
    }
    handle = () => new Response('<rss>');
    try {
      await fetchFeed(server.url.href);
      throw new Error('accepted');
    } catch (error) {
      expect(error).toMatchObject({ kind: 'invalid_feed' });
    }
    await expect(fetchFeed('file:///tmp/feed.xml')).rejects.toThrow('protocol');
  });

  test('bounds network requests with a thirty-second timeout', async () => {
    const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(
      AbortSignal.abort(),
    );
    try {
      await expect(fetchFeed(server.url.href)).rejects.toThrow();
      expect(timeout).toHaveBeenCalledWith(30_000);
    } finally {
      timeout.mockRestore();
    }
  });
});
