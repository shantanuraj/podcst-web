import { expect, test, describe } from 'bun:test';
import { adaptFeed } from './parser';
import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(`src/app/api/feed/__fixtures__/${name}`, 'utf-8');

describe('adaptFeed', () => {

test('parsing DutchPod101 feed', async () => {
  const xml = fixture('dutchpod.xml');
  const result = await adaptFeed(xml);

  expect(result).not.toBeNull();
  if (!result) return;

  // Channel metadata
  expect(result.title).toBe('Learn Dutch | DutchPod101.com');
  expect(result.author).toBe('DutchPod101.com');
  expect(result.cover).toBe(
    'https://assets.podcst.app/?p=https%3A%2F%2Fwww.dutchpod101.com%2Fimages%2Fitunes_logo.jpg',
  );
  expect(result.description).toContain('Learn Dutch with Free Podcasts');
  expect(result.link).toBe('https://www.dutchpod101.com');
  expect(result.explicit).toBe(false);
  expect(result.keywords).toContain('learn');
  expect(result.keywords).toContain('dutch');

  // Episodes
  expect(result.episodes.length).toBeGreaterThan(0);

  // Check a video episode (first item)
  const videoEpisode = result.episodes[0];
  expect(videoEpisode.title).toBe(
    'Want to Speak Real Dutch? Get our Free Travel Survival Course Today!',
  );
  expect(videoEpisode.duration).toBe(132); // 2:12
  expect(videoEpisode.file.url).toBe(
    'https://cdn.innovativelanguage.com/sns/em/2021/SurvivalPhrases/glo_promo_44_survival+pathway_travel+link_ILL+1080p_ILL+iPhone360p.mp4',
  );
  expect(videoEpisode.file.type).toBe('video/x-mp4');
  expect(videoEpisode.explicit).toBe(false);

  // Check an audio episode (second item)
  const audioEpisode = result.episodes[1];
  expect(audioEpisode.title).toBe('How This Feed Works');
  expect(audioEpisode.duration).toBe(95); // 1:35
  expect(audioEpisode.file.url).toBe(
    'https://mdn.illops.net/dutchpod101/dutch_pubfeed_l1.mp3',
  );
  expect(audioEpisode.file.type).toBe('audio/mpeg');

  // Check show notes/description
  expect(audioEpisode.showNotes).toContain(
    'Go to DutchPod101.com to get your FREE Lifetime Account!',
  );
});

test('extracts href from Atom-style link elements', async () => {
  const xml = fixture('atom-link.xml');
  const result = await adaptFeed(xml);

  expect(result).not.toBeNull();
  if (!result) return;

  expect(result.title).toBe('Atom Link Test Podcast');
  expect(result.link).toBe('https://example.com/podcast');
  expect(typeof result.link).toBe('string');
});

});
