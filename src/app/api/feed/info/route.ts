import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { getPodcastInfoById } from '@/server/ingest/podcast';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { isCanonicalId } from '@/shared/canonical-id';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get('id');

  if (!id) {
    return NextResponse.json(
      { message: 'parameter `id` required' },
      { status: 400 },
    );
  }

  const podcastId = id;
  if (!isCanonicalId(podcastId)) {
    return NextResponse.json(
      { message: 'parameter `id` must be a number' },
      { status: 400 },
    );
  }

  const session = await getSession();
  const podcast = await getPodcastInfoById(podcastId, session?.userId ?? null);
  if (!podcast) {
    return NextResponse.json(
      { message: 'podcast not found' },
      { status: 404, headers },
    );
  }

  return NextResponse.json(podcast, { headers });
}
