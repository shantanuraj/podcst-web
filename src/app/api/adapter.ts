import { migrateStoredId } from '@/shared/canonical-id';
import type { IPodcastSearchResult, iTunes } from '@/types';

const feedURLExceptions: Record<string, string> = {
  '1473872585': 'https://apple.news/podcast/apple_news_today',
};

export function adaptPodcast(podcast: iTunes.Podcast): IPodcastSearchResult {
  const identity = migrateStoredId(podcast.collectionId);
  const itunesId = 'canonicalId' in identity ? identity.canonicalId : undefined;
  return {
    itunes_id: itunesId,
    author: podcast.artistName,
    cover: podcast.artworkUrl600,
    feed: podcast.feedUrl || (itunesId ? feedURLExceptions[itunesId] : ''),
    thumbnail: podcast.artworkUrl100,
    title: podcast.collectionName,
  };
}

export const adaptResponse = (res: iTunes.Response) =>
  res.results
    .map(adaptPodcast)
    .filter((podcast) => podcast.feed && podcast.itunes_id);
