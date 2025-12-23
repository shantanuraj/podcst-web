import type { IEpisodeInfo, IPodcastEpisodesInfo } from '@/types';
import { Schema } from './Schema';

interface PodcastEpisodeSchemaProps {
  podcast: IPodcastEpisodesInfo;
  episode: IEpisodeInfo;
  url: string;
}

function secondsToIsoDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let iso = 'PT';
  if (h > 0) iso += `${h}H`;
  if (m > 0) iso += `${m}M`;
  if (s > 0) iso += `${s}S`;
  if (iso === 'PT') iso = 'PT0S';
  return iso;
}

export const PodcastEpisodeSchema = ({ podcast, episode, url }: PodcastEpisodeSchemaProps) => {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: episode.title,
    description: episode.summary || episode.title,
    url: url,
    image: episode.episodeArt || episode.cover || podcast.cover,
    datePublished: episode.published ? new Date(episode.published).toISOString() : undefined,
    duration: episode.duration ? secondsToIsoDuration(episode.duration) : undefined,
    associatedMedia: {
      '@type': 'MediaObject',
      contentUrl: episode.file.url,
      encodingFormat: episode.file.type,
    },
    partOfSeries: {
      '@type': 'PodcastSeries',
      name: podcast.title,
      url: podcast.id
        ? `${new URL(url).origin}/episodes/${podcast.id}`
        : `${new URL(url).origin}/episodes/${encodeURIComponent(podcast.feed)}`,
    },
  };

  return <Schema data={data} />;
};
