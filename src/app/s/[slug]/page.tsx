import { redirect } from 'next/navigation';
import { cache } from '@/app/api/redis';
import { sql } from '@/server/db';
import { resolveShortUrl } from '@/server/ingest/short-url';

interface ShortUrlPageProps {
  params: Promise<{ slug: string }>;
}

export default async function ShortUrlPage({ params }: ShortUrlPageProps) {
  const { slug } = await params;
  const link = await cache.getShortUrl(slug);
  const target = link ? await resolveShortUrl(sql, link) : null;
  if (!target) redirect('/');
  redirect(
    target.episodeId
      ? `/episodes/${target.podcastId}/${target.episodeId}`
      : `/episodes/${target.podcastId}`,
  );
}
