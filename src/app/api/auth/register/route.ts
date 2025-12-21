import { NextRequest, NextResponse } from 'next/server';
import { getRegistrationOptions, verifyRegistration } from '@/server/auth/passkey';
import { createSession } from '@/server/auth/session';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, response, userId, visitorId } = body;

  if (!visitorId) {
    return NextResponse.json({ error: 'Visitor ID required' }, { status: 400 });
  }

  if (!response) {
    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const { options, userId } = await getRegistrationOptions(email, visitorId);
    return NextResponse.json({ options, userId });
  }

  if (!userId) {
    return NextResponse.json({ error: 'User ID required' }, { status: 400 });
  }

  const result = await verifyRegistration(userId, visitorId, response);

  if (result.verified) {
    await createSession(userId);
  }

  return NextResponse.json(result);
}
