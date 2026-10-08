import { expect, test } from 'bun:test';
import type { IEpisodeInfo, IPodcastInfo } from '@/types';
import { type PublicEpisode, publicEpisodeResponse } from './public-episode';

const found = (podcastId = '301', isPrivate = false): PublicEpisode => ({
  podcast: { id: '301', isPrivate } as IPodcastInfo,
  episode: { id: '88412', podcastId } as IEpisodeInfo,
});

const status = async (
  episodeId: string,
  podcastId: string | null,
  load: () => Promise<PublicEpisode | null>,
) => (await publicEpisodeResponse(episodeId, podcastId, load)).status;

test('returns the public episode with its podcast', async () => {
  const response = await publicEpisodeResponse('88412', '301', async () =>
    found(),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(found() as never);
  expect(response.headers.get('Cache-Control')).toContain('public');
});

test('rejects non-canonical identifiers before loading', async () => {
  const load = async () => {
    throw new Error('loaded');
  };
  expect(await status('088412', '301', load)).toBe(400);
  expect(await status('88412', null, load)).toBe(400);
  expect(await status('88412', '9223372036854775808', load)).toBe(400);
});

test('hides missing, mismatched and private episodes alike', async () => {
  expect(await status('88412', '301', async () => null)).toBe(404);
  expect(await status('88412', '302', async () => found())).toBe(404);
  expect(await status('88412', '301', async () => found('302'))).toBe(404);
  expect(await status('88412', '301', async () => found('301', true))).toBe(
    404,
  );
});

test('reports backend failure as unavailable', async () => {
  expect(
    await status('88412', '301', async () => {
      throw new Error('down');
    }),
  ).toBe(503);
});
