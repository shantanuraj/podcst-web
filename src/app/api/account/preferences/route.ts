import { type NextRequest, NextResponse } from 'next/server';
import { savePreferences } from '@/server/account';
import { getSession } from '@/server/auth/session';
import { privateFeedHeaders as headers } from '@/server/podcast-access';
import { parsePreferences } from '@/shared/preferences';

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const preferences = parsePreferences(await request.json().catch(() => null));
  if (!preferences)
    return NextResponse.json(
      { message: 'speed, volumeBoost and trimSilence required' },
      { status: 400 },
    );
  await savePreferences(session.userId, preferences);
  return NextResponse.json(preferences, { headers });
}
