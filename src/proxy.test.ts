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

  test('localized charts and unrelated routes do not run the proxy', () => {
    expect(config.matcher).toEqual(['/', '/feed/top']);
    for (const pathname of [
      ...i18n.locales.map((locale) => `/${locale}/feed/top`),
      '/episodes/1',
      '/episodes/1/123',
      '/api/top',
      '/_next/static/chunk.js',
    ]) {
      expect(
        proxy(new NextRequest(`https://www.podcst.app${pathname}`)).headers.get(
          'location',
        ),
      ).toBeNull();
    }
  });

  test('root requests reach locale selection without a prior config redirect', async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects?.some(({ source }) => source === '/')).toBe(false);
  });
});
