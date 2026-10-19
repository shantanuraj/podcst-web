import { describe, expect, test } from 'bun:test';
import { type CatalogRow, catalogInput } from './catalog';

const row = (imageUrl: string): CatalogRow => ({
  id: 1,
  url: 'https://example.com/feed.xml',
  title: 'Podcast',
  lastUpdate: null,
  link: '',
  dead: 0,
  itunesAuthor: 'Author',
  explicit: 0,
  imageUrl,
  newestItemPubdate: null,
  language: 'en',
  episodeCount: null,
  popularityScore: null,
  priority: null,
  updateFrequency: null,
  description: '',
});

describe('catalogInput', () => {
  test('routes public cover art through the image proxy', () => {
    expect(
      catalogInput(row('https://cdn.example.com/cover.jpg'), 1).cover,
    ).toBe(
      'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2Fcover.jpg',
    );
  });

  test('keeps proxied cover art unchanged', () => {
    const proxied =
      'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2Fcover.jpg';
    expect(catalogInput(row(proxied), 1).cover).toBe(proxied);
  });

  test('falls back to the placeholder for missing or unusable art', () => {
    for (const imageUrl of ['', '/cover.jpg', 'data:image/png;base64,abc']) {
      expect(catalogInput(row(imageUrl), 1).cover).toBe(
        'https://podcst.app/placeholder.png',
      );
    }
  });
});
