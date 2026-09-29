import { notFound, redirect } from 'next/navigation';
import { sql } from '@/server/db';
import { resolvePodcast } from '@/server/ingest/resolve-podcast';

export const dynamic = 'force-dynamic';

export default async function Profile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const itunesId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(itunesId) || itunesId <= 0) {
    notFound();
  }
  const podcastId = await resolvePodcast(sql, itunesId);
  if (podcastId === null) notFound();

  redirect(`/episodes/${podcastId}`);
}
