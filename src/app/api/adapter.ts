/**
 * Podcast adapter module
 */

import { IPodcast, iTunes } from '../../types';

/**
 * Adapt iTunes podcast to App podcast
 */
export const adaptPodcast = (podcast: iTunes.Podcast): IPodcast => ({
  id: podcast.collectionId,
  author: podcast.artistName,
  categories: podcast.genreIds.map((c) => parseInt(c, 10)),
  count: podcast.trackCount,
  cover: podcast.artworkUrl600,
  explicit: podcast.collectionExplicitness,
  feed:
    podcast.feedUrl || feedURLExceptions[podcast.collectionId as keyof typeof feedURLExceptions],
  thumbnail: podcast.artworkUrl100,
  title: podcast.collectionName,
});

/**
 * Filters out podcasts without feed URL
 */
const withFeed = (podcast: IPodcast): boolean => !!podcast.feed;

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
