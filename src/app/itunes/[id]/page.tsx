import { notFound, redirect } from 'next/navigation';
import { sql } from '@/server/db';
import { resolvePodcast } from '@/server/ingest/resolve-podcast';
import { isCanonicalId } from '@/shared/canonical-id';

export const dynamic = 'force-dynamic';

export default async function Profile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const itunesId = id;
  if (!isCanonicalId(itunesId)) {
    notFound();
  }
  const podcastId = await resolvePodcast(sql, itunesId);
  if (podcastId === null) notFound();

  redirect(`/episodes/${podcastId}`);
}
