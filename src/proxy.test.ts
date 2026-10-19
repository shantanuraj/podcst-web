import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import nextConfig from '../next.config';
import { i18n } from './i18.conf';
import proxy, { config } from './proxy';

describe('chart redirects', () => {
  test.each([
    '/',
    '/feed/top',
  ])('%s redirects directly to the default region', (pathname) => {
    const response = proxy(
      new NextRequest(`https://www.podcst.app${pathname}`),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/us/feed/top',
    );
  });

  test('the saved region takes precedence over browser languages', () => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/', {
        headers: {
          cookie: 'NEXT_LOCALE=ca',
          'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8',
        },
      }),
    );
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/ca/feed/top',
    );
  });

  test('an invalid saved region falls back to browser languages', () => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/feed/top', {
        headers: {
          cookie: 'NEXT_LOCALE=unknown',
          'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8',
        },
      }),
    );
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/nl/feed/top',
    );
  });

  test('the first browser language with a listed region decides', () => {
    for (const [languages, region] of [
      ['ko-KR,ko;q=0.9', 'kr'],
      ['en-GB,sv-SE;q=0.8', 'se'],
      ['nb-NO', 'no'],
      ['en-US', 'us'],
    ])
      expect(
        proxy(
          new NextRequest('https://www.podcst.app/', {
            headers: { 'accept-language': languages },
          }),
        ).headers.get('location'),
      ).toBe(`https://www.podcst.app/${region}/feed/top`);
  });

  test('unsupported browser languages use the default region', () => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/', {
        headers: { 'accept-language': 'en-GB,en;q=0.9' },
      }),
    );
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/us/feed/top',
    );
  });

  test('redirects preserve query parameters', () => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/?source=bookmark&term=a%20b'),
    );
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/us/feed/top?source=bookmark&term=a%20b',
    );
  });

  test('unrelated routes and image endpoints pass through', () => {
    for (const pathname of [
      '/episodes/1',
      '/episodes/1/123',
      '/api/top',
      '/_next/static/chunk.js',
      '/us/feed/top/opengraph-image',
      '/us/feed/top/twitter-image',
      '/us/feed/top/chart/other',
    ]) {
      const response = proxy(
        new NextRequest(`https://www.podcst.app${pathname}`),
      );
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    }
  });

  test('root requests reach locale selection without a prior config redirect', async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects?.some(({ source }) => source === '/')).toBe(false);
  });
});

describe('shared Discover rewrites', () => {
  test.each([
    ...i18n.locales,
  ])('%s uses its own country cache key', (locale) => {
    const response = proxy(
      new NextRequest(`https://www.podcst.app/${locale}/feed/top`),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      `https://www.podcst.app/discover-render/en/${locale}/feed/top`,
    );
    expect(response.headers.get('location')).toBeNull();
  });

  test.each([
    'en',
    'nl',
    'fr',
    'sv',
    'ko',
    'es',
    'hi',
  ])('%s uses its own language cache key', (language) => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/ca/feed/top/chart', {
        headers: {
          cookie: `NEXT_UI_LANG=${language}; NEXT_LOCALE=us; session=private-account`,
        },
      }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      `https://www.podcst.app/discover-render/${language}/ca/feed/top/chart`,
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test.each([
    'unknown',
    'FR',
    'constructor',
    'toString',
    '__proto__',
  ])('invalid language %s uses English', (language) => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/nl/feed/top', {
        headers: { cookie: `NEXT_UI_LANG=${language}` },
      }),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://www.podcst.app/discover-render/en/nl/feed/top',
    );
  });

  test('rewrites preserve repeated and encoded query values', () => {
    const response = proxy(
      new NextRequest(
        'https://www.podcst.app/fr/feed/top/chart?tag=a&tag=b&term=a%20b&_rsc=fixture',
      ),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://www.podcst.app/discover-render/en/fr/feed/top/chart?tag=a&tag=b&term=a%20b&_rsc=fixture',
    );
  });

  test.each([
    'unknown',
    'gb',
    'US',
    'constructor',
  ])('unsupported country %s cannot create a cache key', (locale) => {
    const response = proxy(
      new NextRequest(`https://www.podcst.app/${locale}/feed/top`),
    );
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  test.each([
    '',
    '/chart',
  ])('rewritten %s requests pass through without redirecting to the public URL', (suffix) => {
    const response = proxy(
      new NextRequest(
        `https://www.podcst.app/ca/feed/top${suffix}?source=link`,
        { headers: { cookie: 'NEXT_UI_LANG=fr' } },
      ),
    );
    const destination = response.headers.get('x-middleware-rewrite');
    expect(destination).toBe(
      `https://www.podcst.app/discover-render/fr/ca/feed/top${suffix}?source=link`,
    );
    if (!destination) throw new Error('Discover rewrite missing');
    const rewritten = proxy(new NextRequest(destination));
    expect(rewritten.headers.get('x-middleware-next')).toBe('1');
    expect(rewritten.headers.get('location')).toBeNull();
    expect(rewritten.headers.get('x-middleware-rewrite')).toBeNull();
  });

  test('matcher includes public Discover routes and skips internal destinations', () => {
    expect(config.matcher).toContain('/:locale/feed/top/:path*');
    expect(config.matcher).not.toContain('/discover-render/:path*');
  });

  test('cross-origin API mutations are still refused', () => {
    const response = proxy(
      new NextRequest('https://www.podcst.app/api/top', {
        method: 'POST',
        headers: {
          origin: 'https://untrusted.invalid',
          'sec-fetch-site': 'cross-site',
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
