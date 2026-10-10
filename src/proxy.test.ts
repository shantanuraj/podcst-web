import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import nextConfig from '../next.config';
import { i18n } from './i18.conf';
import proxy, { config } from './proxy';

describe('chart redirects and admission coverage', () => {
  test.each([
    '/',
    '/feed/top',
  ])('%s redirects directly to the default region', async (pathname) => {
    const response = await proxy(
      new NextRequest(`https://www.podcst.app${pathname}`),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/us/feed/top',
    );
  });
  test.each([
    [
      {
        cookie: 'NEXT_LOCALE=ca',
        'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
      'ca',
    ],
    [
      {
        cookie: 'NEXT_LOCALE=unknown',
        'accept-language': 'nl-NL,nl;q=0.9,en;q=0.8',
      },
      'nl',
    ],
    [{ 'accept-language': 'ko-KR,ko;q=0.9' }, 'kr'],
    [{ 'accept-language': 'en-GB,sv-SE;q=0.8' }, 'se'],
    [{ 'accept-language': 'nb-NO' }, 'no'],
    [{ 'accept-language': 'en-US' }, 'us'],
    [{ 'accept-language': 'en-GB,en;q=0.9' }, 'us'],
  ])('selects the saved or negotiated region: %j', async (headers, region) => {
    const response = await proxy(
      new NextRequest('https://www.podcst.app/', {
        headers: headers as Record<string, string>,
      }),
    );
    expect(response.headers.get('location')).toBe(
      `https://www.podcst.app/${region}/feed/top`,
    );
  });
  test('redirects preserve query parameters', async () => {
    const response = await proxy(
      new NextRequest('https://www.podcst.app/?source=bookmark&term=a%20b'),
    );
    expect(response.headers.get('location')).toBe(
      'https://www.podcst.app/us/feed/top?source=bookmark&term=a%20b',
    );
  });
  test('all paths run admission without redirecting localized or unrelated routes', async () => {
    expect(config.matcher).toEqual(['/:path*']);
    for (const pathname of [
      ...i18n.locales.map((locale) => `/${locale}/feed/top`),
      '/episodes/1',
      '/episodes/1/123',
      '/api/top',
      '/_next/static/chunk.js',
    ]) {
      expect(
        (
          await proxy(new NextRequest(`https://www.podcst.app${pathname}`))
        ).headers.get('location'),
      ).toBeNull();
    }
  });
  test('missing admission configuration closes health, auth, private reads and cached pages', async () => {
    const previous = process.env.RECOVERY_ADMISSION_REQUIRED;
    process.env.RECOVERY_ADMISSION_REQUIRED = '1';
    try {
      for (const path of [
        '/api/health',
        '/api/auth/session',
        '/api/feed/1',
        '/us/account',
        '/_next/image',
      ]) {
        const response = await proxy(
          new NextRequest(`https://www.podcst.app${path}`),
        );
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    } finally {
      if (previous === undefined)
        delete process.env.RECOVERY_ADMISSION_REQUIRED;
      else process.env.RECOVERY_ADMISSION_REQUIRED = previous;
    }
  });
  test('root requests reach locale selection without a prior config redirect', async () => {
    expect(
      (await nextConfig.redirects?.())?.some(({ source }) => source === '/'),
    ).toBe(false);
  });
});
