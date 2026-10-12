import { NextResponse } from 'next/server';
import { getAccount } from '@/server/account';
import { getSession } from '@/server/auth/session';
import { privateFeedHeaders as headers } from '@/server/podcast-access';

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getAccount(session.userId), { headers });
}
