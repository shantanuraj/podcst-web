import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import {
  getSubscriptions,
  addSubscription,
  addSubscriptions,
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
    const result = await addSubscriptions(session.userId, body.feedUrls);
    return NextResponse.json(result);
  }

  const feedUrl = body.feedUrl;
  if (!feedUrl || typeof feedUrl !== 'string') {
    return NextResponse.json({ error: 'feedUrl or feedUrls required' }, { status: 400 });
  }

  const success = await addSubscription(session.userId, feedUrl);
  if (!success) {
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const feedUrl = searchParams.get('feedUrl');
  if (!feedUrl) {
    return NextResponse.json({ error: 'feedUrl required' }, { status: 400 });
  }

  await removeSubscription(session.userId, feedUrl);
  return NextResponse.json({ success: true });
}
