import type { RenderablePodcast, IPodcastEpisodesInfo } from '@/types';
import { Schema } from './Schema';

interface ItemListSchemaProps {
  items: RenderablePodcast[];
  title: string;
}

function getPodcastUrl(item: RenderablePodcast): string {
  if ('episodes' in item && (item as IPodcastEpisodesInfo).id) {
    return `https://www.podcst.app/episodes/${(item as IPodcastEpisodesInfo).id}`;
  }
  return `https://www.podcst.app/episodes/${encodeURIComponent(item.feed)}`;
}

export const ItemListSchema = ({ items, title }: ItemListSchemaProps) => {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: title,
    itemListElement: items
      .map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'PodcastSeries',
          name: item.title,
          url: getPodcastUrl(item),
          image: 'cover' in item ? item.cover : undefined,
        },
      }))
      .slice(0, 10),
  };

  return <Schema data={data} />;
};
