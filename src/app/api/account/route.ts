import { NextResponse } from 'next/server';
import { getAccountForSession } from '@/server/account';
import { getSessionId } from '@/server/auth/session';
import { privateFeedHeaders as headers } from '@/server/podcast-access';

export async function GET() {
  const sessionId = await getSessionId();
  const account = sessionId ? await getAccountForSession(sessionId) : null;
  if (!account)
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(account, { headers });
}
