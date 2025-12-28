import { getPodcastIdByItunesId } from '@/server/ingest/podcast';
import { redirect } from 'next/navigation';

export default async function Profile({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const podcastId = await getPodcastIdByItunesId(id);

  if (!podcastId) {
    redirect('/episodes');
  }

  redirect(`/episodes/${podcastId}`);
}
