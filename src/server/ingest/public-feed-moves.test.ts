import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { isPublicAddress, requestPublicFeed } from './public-feed-http';
import { verifyPublicFeedMove } from './public-feed-moves';

const xml = readFileSync(
  new URL('./__fixtures__/refresh.xml', import.meta.url),
  'utf8',
);
const old = 'http://feeds.example.invalid/old';
const next = 'https://publisher.example.invalid/current';

const source =
  (status = 301, target = next, body = xml) =>
  async (url: string) =>
    url === old
      ? { status, location: target, body: '' }
      : { status: 200, body };

describe('public move evidence', () => {
  test('records verified permanent hops without trusting title similarity', async () => {
    const result = await verifyPublicFeedMove(old, source());
    expect(result).toMatchObject({
      status: 'verified',
      evidence: {
        requestedUrl: old,
        canonicalFeedUrl: next,
        aliases: [old, next],
      },
    });
    if (result.status !== 'verified') throw new Error('Missing proof');
    expect(result.evidence.details).toMatchObject({
      hops: [{ from: old, to: next, status: 301 }],
      policy: 'public-permanent-v1',
    });
  });
  test.each([
    302, 303, 307,
  ])('temporary %s redirects are delivery only', async (status) => {
    expect(await verifyPublicFeedMove(old, source(status))).toMatchObject({
      status: 'verification_pending',
      reason: 'temporary_redirect',
    });
  });
  test('a permanent hop followed by a temporary hop does not establish an alias', async () => {
    expect(
      await verifyPublicFeedMove(old, async (url) => {
        if (url === old) return { status: 301, location: next, body: '' };
        if (url === next)
          return {
            status: 302,
            location: 'https://cdn.example.invalid/body',
            body: '',
          };
        return { status: 200, body: xml };
      }),
    ).toMatchObject({
      status: 'verification_pending',
      reason: 'temporary_redirect',
    });
  });
  test('publisher hints alone do not move a source', async () => {
    const hinted = xml.replace(
      '</channel>',
      `<itunes:new-feed-url>${next}</itunes:new-feed-url></channel>`,
    );
    expect(
      await verifyPublicFeedMove(old, async () => ({
        status: 200,
        body: hinted,
      })),
    ).toMatchObject({
      status: 'verification_pending',
      reason: 'publisher_hint_requires_review',
    });
  });
  test('conflicting self links and delivery query parameters need review', async () => {
    const body = xml.replace(
      '</channel>',
      '<atom:link rel="self" href="https://different.example.invalid/rss" /></channel>',
    );
    expect(
      await verifyPublicFeedMove(old, source(301, next, body)),
    ).toMatchObject({ reason: 'conflicting_feed_hint' });
    expect(
      await verifyPublicFeedMove(old, source(301, `${next}?signed=synthetic`)),
    ).toMatchObject({ reason: 'delivery_parameters_require_review' });
  });
  test('rejects credentials and unsafe schemes at every hop', async () => {
    await expect(
      verifyPublicFeedMove(old, source(301, 'file:///tmp/feed')),
    ).rejects.toThrow();
    await expect(
      verifyPublicFeedMove(
        old,
        source(301, 'https://name:secret@example.invalid/rss'),
      ),
    ).rejects.toThrow();
    expect(
      await verifyPublicFeedMove('https://example.invalid/rss', async () => ({
        status: 301,
        location: 'http://example.invalid/rss',
        body: '',
      })),
    ).toMatchObject({ reason: 'insecure_redirect' });
  });
  test('bounds loops, long chains and invalid destination feeds', async () => {
    expect(
      await verifyPublicFeedMove(old, async () => ({
        status: 301,
        location: old,
        body: '',
      })),
    ).toMatchObject({ reason: 'redirect_loop' });
    let count = 0;
    expect(
      await verifyPublicFeedMove(old, async () => ({
        status: 301,
        location: `https://example.invalid/${count++}`,
        body: '',
      })),
    ).toMatchObject({ reason: 'redirect_limit' });
    expect(count).toBe(6);
    expect(
      await verifyPublicFeedMove(
        old,
        source(301, next, '<rss><channel /></rss>'),
      ),
    ).toMatchObject({ reason: 'invalid_feed' });
  });
});

describe('bounded public HTTP transport', () => {
  let handler: (request: Request) => Response = () => new Response(xml);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => handler(request),
  });
  afterAll(() => server.stop(true));
  const fixtureUrl = `http://fixture.example.invalid:${server.port}/rss`;
  const resolveFixture = async () => '127.0.0.1';

  test.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '192.168.1.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])('blocks nonpublic %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  test('allows globally routable addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
  });
  test('production resolution refuses loopback without connecting', async () => {
    await expect(
      requestPublicFeed(server.url.href, AbortSignal.timeout(1000)),
    ).rejects.toThrow('Nonpublic');
  });
  test('pins the resolved connection while preserving the original Host', async () => {
    handler = (request) => {
      expect(request.headers.get('host')).toBe(
        `fixture.example.invalid:${server.port}`,
      );
      return new Response(xml);
    };
    expect(
      await requestPublicFeed(
        fixtureUrl,
        AbortSignal.timeout(1000),
        resolveFixture,
      ),
    ).toMatchObject({ status: 200, body: xml });
  });
  test('does not follow a redirect inside the transport', async () => {
    handler = () =>
      new Response(null, {
        status: 301,
        headers: { location: 'http://127.0.0.1/private' },
      });
    expect(
      await requestPublicFeed(
        fixtureUrl,
        AbortSignal.timeout(1000),
        resolveFixture,
      ),
    ).toMatchObject({ status: 301, location: 'http://127.0.0.1/private' });
  });
  test('bounds raw and decompressed response bodies', async () => {
    handler = () => new Response('x'.repeat(2048));
    await expect(
      requestPublicFeed(
        fixtureUrl,
        AbortSignal.timeout(1000),
        resolveFixture,
        1024,
      ),
    ).rejects.toThrow();
    handler = () =>
      new Response(gzipSync('x'.repeat(2048)), {
        headers: { 'content-encoding': 'gzip' },
      });
    await expect(
      requestPublicFeed(
        fixtureUrl,
        AbortSignal.timeout(1000),
        resolveFixture,
        1024,
      ),
    ).rejects.toThrow('oversized');
  });
  test('decodes bounded gzip and aborts a stalled lookup', async () => {
    handler = () =>
      new Response(gzipSync(xml), { headers: { 'content-encoding': 'gzip' } });
    expect(
      (
        await requestPublicFeed(
          fixtureUrl,
          AbortSignal.timeout(1000),
          resolveFixture,
        )
      ).body,
    ).toBe(xml);
    await expect(
      requestPublicFeed(
        fixtureUrl,
        AbortSignal.timeout(10),
        () => new Promise(() => {}),
      ),
    ).rejects.toThrow('timed out');
  });
});
