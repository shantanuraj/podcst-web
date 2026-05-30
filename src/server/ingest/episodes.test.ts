import { expect, test } from 'bun:test';
import { buildRows } from './episodes';

const ep = (over = {}) => ({
  guid: 'g1',
  title: 'T',
  showNotes: 'S',
  published: '2020-01-01',
  duration: 60,
  episodeArt: 'art',
  file: { url: 'u', length: 1, type: 'audio/mpeg' },
  ...over,
});

test('drops rows without guid or file url', () => {
  expect(buildRows([ep({ guid: null })] as any, null)).toHaveLength(0);
  expect(buildRows([ep({ file: { url: null } })] as any, null)).toHaveLength(0);
});

test('art stored only when different from cover', () => {
  expect(
    buildRows([ep({ episodeArt: 'cover' })] as any, 'cover')[0].episode_art,
  ).toBeNull();
  expect(
    buildRows([ep({ episodeArt: 'other' })] as any, 'cover')[0].episode_art,
  ).toBe('other');
});
