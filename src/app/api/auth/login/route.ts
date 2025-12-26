import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticationOptions,
  verifyAuthentication,
} from '@/server/auth/passkey';
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

    try {
      const { options, userId } = await getAuthenticationOptions(
        email,
        visitorId,
      );
      return NextResponse.json({ options, userId });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authentication failed';
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'User ID required' }, { status: 400 });
  }

  try {
    const result = await verifyAuthentication(userId, visitorId, response);

    if (result.verified) {
      await createSession(result.userId);
    }

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Authentication failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
