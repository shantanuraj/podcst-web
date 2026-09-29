/**
 * Podcast adapter module
 */

import type { IPodcastSearchResult, iTunes } from '@/types';

/**
 * Adapt iTunes podcast to App podcast
 */
export const adaptPodcast = (
  podcast: iTunes.Podcast,
): IPodcastSearchResult => ({
  itunes_id: podcast.collectionId,
  author: podcast.artistName,
  cover: podcast.artworkUrl600,
  feed:
    podcast.feedUrl ||
    feedURLExceptions[podcast.collectionId as keyof typeof feedURLExceptions],
  thumbnail: podcast.artworkUrl100,
  title: podcast.collectionName,
});

/**
 * Filters out podcasts without feed URL
 */
const withFeed = (podcast: IPodcastSearchResult): boolean =>
  !!podcast.feed &&
  Number.isSafeInteger(podcast.itunes_id) &&
  (podcast.itunes_id ?? 0) > 0;

/**
 * Adapt iTunes response
 */
export const adaptResponse = (res: iTunes.Response) =>
  res.results.map(adaptPodcast).filter(withFeed);

/**
 * Feed URL exceptions
 */
const feedURLExceptions = {
  1473872585: 'https://apple.news/podcast/apple_news_today',
};
