import { type NextRequest, NextResponse } from 'next/server';
import { refreshPodcast } from '@/server/ingest/podcast';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { url } = body;

  if (!url) {
    return NextResponse.json({ message: 'url required' }, { status: 400 });
  }

  const podcast = await refreshPodcast(url);

  if (!podcast) {
    return NextResponse.json({ message: 'Failed to refresh feed' }, { status: 500 });
  }

  return NextResponse.json(podcast);
}
