import { describe, expect, test } from 'bun:test';
import { proxiedPodcastArt } from './proxy-podcast-art';

const proxied =
  'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2Fcover.jpg';
const row = (cover: string, thumbnail: string | null = null) => ({
  id: '1',
  cover,
  thumbnail,
});

describe('proxiedPodcastArt', () => {
  test('wraps direct covers and thumbnails like the feed parser', () => {
    expect(
      proxiedPodcastArt(
        row(
          'https://cdn.example.com/cover.jpg',
          'https://cdn.example.com/ép.jpg',
        ),
      ),
    ).toEqual({
      cover: proxied,
      thumbnail:
        'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2F%25C3%25A9p.jpg',
    });
  });

  test('keeps proxied art, the placeholder, and missing thumbnails', () => {
    expect(proxiedPodcastArt(row(proxied, proxied))).toEqual({
      cover: proxied,
      thumbnail: proxied,
    });
    expect(
      proxiedPodcastArt(row('https://podcst.app/placeholder.png')),
    ).toEqual({ cover: 'https://podcst.app/placeholder.png', thumbnail: null });
  });

  test('replaces unusable art with the placeholder and drops bad thumbnails', () => {
    expect(proxiedPodcastArt(row('/cover.jpg', 'file:///t.jpg'))).toEqual({
      cover: 'https://podcst.app/placeholder.png',
      thumbnail: null,
    });
  });
});
