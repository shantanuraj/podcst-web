import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { sql } from '@/server/db';
import { resolveInteractivePodcast } from '@/server/ingest/interactive-admission';
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
  const podcastId = await resolveInteractivePodcast(
    sql,
    itunesId,
    undefined,
    new Headers(await headers()),
  ).catch(() => undefined);
  if (podcastId === undefined)
    return (
      <main>
        <h1>Podcast temporarily unavailable</h1>
        <p>Resolution could not finish. Please try again shortly.</p>
        <a href={`/itunes/${itunesId}`}>Retry</a>
      </main>
    );
  if (podcastId === null) notFound();

  redirect(`/episodes/${podcastId}`);
}
