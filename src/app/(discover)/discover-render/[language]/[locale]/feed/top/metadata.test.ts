import { expect, test } from 'bun:test';
import { generateMetadata as chartMetadata } from './chart/page';
import { generateMetadata as discoverMetadata } from './page';

test('Discover metadata uses the explicit language and public URLs without request cookies', async () => {
  const metadata = await discoverMetadata({
    params: Promise.resolve({ locale: 'ca', language: 'fr' }),
  });
  expect(metadata.title).toBe('Classements');
  expect(metadata.alternates?.canonical).toBe('/ca/feed/top');
  expect(metadata.openGraph).toMatchObject({
    url: '/ca/feed/top',
    images: [{ url: '/ca/feed/top/opengraph-image', width: 1200, height: 630 }],
  });
  expect(metadata.twitter).toMatchObject({
    images: ['/ca/feed/top/twitter-image'],
  });
});

test('chart metadata retains the public country URL and translated title', async () => {
  const metadata = await chartMetadata({
    params: Promise.resolve({ locale: 'ca', language: 'fr' }),
  });
  expect(metadata.title).toBe('Podcasts populaires en Canada');
  expect(metadata.alternates?.canonical).toBe('/ca/feed/top/chart');
  expect(metadata.openGraph).toMatchObject({
    url: '/ca/feed/top/chart',
    images: [{ url: '/ca/feed/top/opengraph-image', width: 1200, height: 630 }],
  });
});
