import { type NextRequest, NextResponse } from 'next/server';
import { getPodcastInfoById } from '@/server/ingest/podcast';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get('id');

  if (!id) {
    return NextResponse.json(
      { message: 'parameter `id` required' },
      { status: 400 },
    );
  }

  const podcastId = parseInt(id, 10);
  if (Number.isNaN(podcastId)) {
    return NextResponse.json(
      { message: 'parameter `id` must be a number' },
      { status: 400 },
    );
  }

  const podcast = await getPodcastInfoById(podcastId);
  if (!podcast) {
    return NextResponse.json({ message: 'podcast not found' }, { status: 404 });
  }

  return NextResponse.json(podcast);
}
