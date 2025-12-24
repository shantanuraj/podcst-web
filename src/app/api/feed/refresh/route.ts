import { type NextRequest, NextResponse } from 'next/server';
import { refreshPodcast } from '@/server/ingest/podcast';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { podcastId } = body;

  if (!podcastId) {
    return NextResponse.json({ message: 'podcastId required' }, { status: 400 });
  }

  const podcast = await refreshPodcast(Number(podcastId));

  if (!podcast) {
    return NextResponse.json({ message: 'Failed to refresh feed' }, { status: 500 });
  }

  return NextResponse.json(podcast);
}
