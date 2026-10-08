import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { gzipSync } from 'node:zlib';
import { resolvePublicAddress } from '../http/public-destination';
import { fetchFeedResponse } from './feed-http';
import { requestFeed } from './feed-request';

let handler: (request: IncomingMessage, response: ServerResponse) => void;
const server = createServer((request, response) => handler(request, response));
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('Fixture server unavailable');
const base = `http://fixture.example.invalid:${address.port}`;
const resolve = async () => '127.0.0.1';
const get = (url = base, options = {}) =>
  fetchFeedResponse(url, {}, { resolve, ...options });

beforeEach(() => {
  handler = (_, response) => response.end('<rss/>');
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('ordinary feed transport', () => {
  test('production resolution blocks local and mixed destinations', async () => {
    await expect(
      fetchFeedResponse(
        `http://127.0.0.1:${address.port}/secret?token=private`,
      ),
    ).rejects.toThrow('Nonpublic');
    await expect(
      resolvePublicAddress('mixed.invalid', async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow('Nonpublic');
  });

  test('honors caller cancellation before lookup and during a streamed response', async () => {
    let requests = 0;
    const before = new AbortController();
    before.abort();
    await expect(get(base, { signal: before.signal })).rejects.toThrow();
    const active = new AbortController();
    handler = (_, response) => {
      requests++;
      response.write('<rss>');
      active.abort();
    };
    await expect(
      get(`${base}/slow?token=synthetic`, { signal: active.signal }),
    ).rejects.toThrow();
    expect(requests).toBe(1);
  });

  test('pins each hop, preserves query tokens and sends no application credentials', async () => {
    const hosts: string[] = [];
    handler = (request, response) => {
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      if (request.url?.startsWith('/start')) {
        expect(request.url).toBe('/start?token=a%2Bb&token=c+d&z=%2f');
        response.writeHead(302, { location: '/next?token=Q%2b%2F' }).end();
      } else {
        expect(request.url).toBe('/next?token=Q%2b%2F');
        expect(request.headers.host).toBe(
          `fixture.example.invalid:${address.port}`,
        );
        response.end('<rss/>');
      }
    };
    const result = await get(`${base}/start?token=a%2Bb&token=c+d&z=%2f`, {
      resolve: async (host: string) => {
        hosts.push(host);
        return '127.0.0.1';
      },
    });
    expect(result.redirected).toBe(true);
    expect(hosts).toEqual([
      'fixture.example.invalid',
      'fixture.example.invalid',
    ]);
  });

  test('revalidates a redirect and refuses rebinding', async () => {
    let lookups = 0;
    handler = (_, response) =>
      response.writeHead(302, { location: '/next' }).end();
    await expect(
      get(base, {
        resolve: async () => {
          if (++lookups > 1)
            return resolvePublicAddress('rebound.invalid', async () => [
              { address: '127.0.0.1', family: 4 },
            ]);
          return '127.0.0.1';
        },
      }),
    ).rejects.toThrow('Nonpublic');
    expect(lookups).toBe(2);
  });

  test('bounds redirects and rejects credentials and non-HTTP destinations', async () => {
    let requests = 0;
    handler = (_, response) => {
      requests++;
      response.writeHead(302, { location: '/again' }).end();
    };
    await expect(get()).rejects.toThrow('redirect');
    expect(requests).toBe(6);
    for (const url of [
      'file:///secret',
      `http://user:secret@fixture.example.invalid:${address.port}`,
      'http://[::1%bad]/secret',
    ]) {
      try {
        await get(url);
        throw new Error('accepted');
      } catch (error) {
        expect(String(error)).not.toContain('secret');
        expect(String(error)).not.toContain('accepted');
      }
    }
  });

  test('rejects HTTPS downgrade before issuing another request', async () => {
    let requests = 0;
    await expect(
      fetchFeedResponse(
        'https://publisher.example.invalid/rss',
        {},
        {
          transport: async () => {
            requests++;
            return {
              status: 302,
              location: 'http://publisher.example.invalid/rss',
              body: '',
              etag: null,
              lastModified: null,
            };
          },
        },
      ),
    ).rejects.toThrow('downgrade');
    expect(requests).toBe(1);
  });

  test('drops validators at an origin change', async () => {
    const seen: unknown[] = [];
    await fetchFeedResponse(
      'https://publisher.example.invalid/rss',
      { etag: '"original"' },
      {
        transport: async (_, options) => {
          seen.push(options.validators);
          return seen.length === 1
            ? {
                status: 302,
                location: 'https://new.example.invalid/rss',
                body: '',
                etag: null,
                lastModified: null,
              }
            : { status: 200, body: '<rss/>', etag: null, lastModified: null };
        },
      },
    );
    expect(seen).toEqual([{ etag: '"original"' }, {}]);
  });

  test('bounds chunked wire data without a declared length', async () => {
    handler = (_, response) => {
      response.write('x'.repeat(512));
      response.end('x'.repeat(1024));
    };
    await expect(get(base, { maxBytes: 1024 })).rejects.toThrow();
  });

  test('bounds both wire and decoded data', async () => {
    handler = (_, response) => response.end('x'.repeat(2048));
    await expect(get(base, { maxBytes: 1024 })).rejects.toThrow();
    handler = (_, response) =>
      response
        .writeHead(200, { 'content-encoding': 'gzip' })
        .end(gzipSync('x'.repeat(2048)));
    await expect(get(base, { maxBytes: 1024 })).rejects.toThrow('oversized');
    handler = (_, response) =>
      response
        .writeHead(200, { 'content-encoding': 'gzip' })
        .end(gzipSync('<rss/>'));
    expect((await get()).body).toBe('<rss/>');
  });

  test('a total deadline cancels stalled DNS and bodies', async () => {
    await expect(
      get(base, { timeoutMs: 20, resolve: () => new Promise(() => {}) }),
    ).rejects.toThrow();
    handler = (_, response) => {
      response.writeHead(200);
      response.write('<rss>');
    };
    await expect(get(base, { timeoutMs: 20 })).rejects.toThrow();
  });

  test('rejects truncated bodies and unsupported encodings', async () => {
    handler = (_, response) => {
      response.writeHead(200, { 'content-length': '100' });
      response.write('<rss>');
      setTimeout(() => response.destroy(), 5);
    };
    await expect(get()).rejects.toThrow();
    handler = (_, response) =>
      response
        .writeHead(200, { 'content-encoding': 'unknown' })
        .end('private-token');
    await expect(get()).rejects.toThrow('encoding');
  });

  test('validates conditional headers and rejects unsolicited 304', async () => {
    handler = (request, response) => {
      expect(request.headers['if-none-match']).toBe('"version"');
      response.writeHead(304, { etag: '"version"' }).end();
    };
    expect(
      (await fetchFeedResponse(base, { etag: '"version"' }, { resolve }))
        .status,
    ).toBe(304);
    handler = (_, response) => response.writeHead(304).end();
    await expect(get()).rejects.toThrow('304');
    await expect(
      fetchFeedResponse(
        base,
        { etag: 'secret\r\nCookie: private' },
        { resolve },
      ),
    ).rejects.toThrow('304');
  });

  test('one-hop requests do not follow redirects', async () => {
    handler = (_, response) =>
      response.writeHead(301, { location: 'http://127.0.0.1/private' }).end();
    expect(
      await requestFeed(base, { signal: AbortSignal.timeout(1000), resolve }),
    ).toMatchObject({ status: 301, location: 'http://127.0.0.1/private' });
  });
});
