import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import {
  addSubscription,
  getSubscriptions,
  importSubscriptions,
  removeSubscription,
} from '@/server/subscriptions';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const subscriptions = await getSubscriptions(session.userId);
  return NextResponse.json(subscriptions);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  if (Array.isArray(body.feedUrls)) {
    const result = await importSubscriptions(session.userId, body.feedUrls);
    return NextResponse.json(result);
  }

  const podcastId = body.podcastId;
  if (!podcastId || typeof podcastId !== 'number') {
    return NextResponse.json({ error: 'podcastId required' }, { status: 400 });
  }

  const success = await addSubscription(session.userId, podcastId);
  if (!success) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const podcastId = searchParams.get('podcastId');
  if (!podcastId) {
    return NextResponse.json({ error: 'podcastId required' }, { status: 400 });
  }

  await removeSubscription(session.userId, Number(podcastId));
  return NextResponse.json({ success: true });
}
