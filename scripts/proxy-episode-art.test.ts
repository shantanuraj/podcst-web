import { describe, expect, test } from 'bun:test';
import { proxiedEpisodeArt } from './proxy-episode-art';

const cover =
  'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2Fcover.jpg';
const row = (episode_art: string) => ({ episode_id: '1', episode_art, cover });

describe('proxiedEpisodeArt', () => {
  test('wraps direct artwork like the feed parser', () => {
    expect(proxiedEpisodeArt(row('https://cdn.example.com/ép 1.jpg'))).toBe(
      'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2F%25C3%25A9p%25201.jpg',
    );
  });

  test('clears artwork equal to the podcast cover', () => {
    expect(
      proxiedEpisodeArt(row('https://cdn.example.com/cover.jpg')),
    ).toBeNull();
  });

  test('keeps proxied and unresolvable artwork', () => {
    const proxied =
      'https://assets.podcst.app/?p=https%3A%2F%2Fcdn.example.com%2Fep.jpg';
    expect(proxiedEpisodeArt(row(proxied))).toBe(proxied);
    expect(proxiedEpisodeArt(row('/relative.jpg'))).toBe('/relative.jpg');
  });
});
