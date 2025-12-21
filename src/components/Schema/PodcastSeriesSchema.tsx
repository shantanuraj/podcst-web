import type { IPodcastEpisodesInfo } from '@/types';
import { Schema } from './Schema';

interface PodcastSeriesSchemaProps {
  podcast: IPodcastEpisodesInfo;
  url: string;
}

export const PodcastSeriesSchema = ({ podcast, url }: PodcastSeriesSchemaProps) => {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    name: podcast.title,
    description: podcast.description,
    url: url,
    image: podcast.cover,
    author: {
      '@type': 'Person',
      name: podcast.author,
    },
    genre: podcast.keywords,
  };

  return <Schema data={data} />;
};
