import { type NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/server/auth/session';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { getCurrentProgress, saveProgress } from '@/server/progress';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const progress = await getCurrentProgress(session.userId);
  return NextResponse.json(progress, { headers });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) ?? {};
  const { episodeId, position, completed } = body;

  if (typeof episodeId !== 'number' || typeof position !== 'number') {
    return NextResponse.json(
      { message: 'episodeId and position required' },
      { status: 400 },
    );
  }

  const success = await saveProgress(
    session.userId,
    episodeId,
    Math.floor(position),
    completed === true,
  );

  if (!success) {
    return NextResponse.json({ message: 'Episode not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
