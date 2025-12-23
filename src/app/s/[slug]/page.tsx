import { redirect } from 'next/navigation';
import { cache } from '@/app/api/redis';

interface ShortUrlPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ShortUrlPage({ params }: ShortUrlPageProps) {
  const { slug } = await params;

  const shortUrl = await cache.getShortUrl(slug);

  if (!shortUrl) {
    redirect('/');
    return;
  }

  const { feed, guid } = shortUrl;
  redirect(`/episodes/${encodeURIComponent(feed)}/${encodeURIComponent(guid)}`);
}
