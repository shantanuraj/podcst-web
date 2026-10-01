import { redirect } from 'next/navigation';
import { cache } from '@/app/api/redis';
import { getPodcastByFeedUrl } from '@/server/ingest/podcast';

interface ShortUrlPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ShortUrlPage({ params }: ShortUrlPageProps) {
  const { slug } = await params;
  const link = await cache.getShortUrl(slug);
  const podcast = link ? await getPodcastByFeedUrl(link.feed) : null;
  if (!podcast?.id || !link) redirect('/');
  const episode = podcast.episodes.find((item) => item.guid === link.guid);
  redirect(
    episode?.id
      ? `/episodes/${podcast.id}/${episode.id}`
      : `/episodes/${podcast.id}`,
  );
}
