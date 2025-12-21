import type { RenderablePodcast } from '@/types';
import { Schema } from './Schema';

interface ItemListSchemaProps {
  items: RenderablePodcast[];
  title: string;
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
          url: `https://www.podcst.app/episodes/${encodeURIComponent(item.feed)}`,
          image: 'cover' in item ? item.cover : undefined,
        },
      }))
      .slice(0, 10), // Limit to first 10 items
  };

  return <Schema data={data} />;
};
