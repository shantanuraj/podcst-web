import { type NextRequest, NextResponse } from 'next/server';
import {
  getRegistrationOptions,
  verifyRegistration,
} from '@/server/auth/passkey';
import { getSession } from '@/server/auth/session';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, response, visitorId } = body;

  if (!visitorId) {
    return NextResponse.json({ error: 'Visitor ID required' }, { status: 400 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    );
  }

  if (email && email !== session.email) {
    return NextResponse.json(
      { error: 'Email does not match current user' },
      { status: 403 },
    );
  }

  try {
    if (!response) {
      const { options } = await getRegistrationOptions(
        session.userId,
        session.email,
        visitorId,
      );
      return NextResponse.json({ options });
    }

    const result = await verifyRegistration(
      session.userId,
      visitorId,
      response,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Passkey registration failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
