import { NextResponse } from 'next/server';
import { deletePasskey } from '@/server/account';
import { getSession } from '@/server/auth/session';
import { privateFeedHeaders as headers } from '@/server/podcast-access';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ passkeyId: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { message: 'Unauthorized' },
      { status: 401, headers },
    );
  const { passkeyId } = await params;
  if (!(await deletePasskey(session.userId, passkeyId)))
    return NextResponse.json(
      { message: 'Passkey not found' },
      { status: 404, headers },
    );
  return NextResponse.json({ success: true }, { headers });
}
