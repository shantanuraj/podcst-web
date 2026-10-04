import { type NextRequest, NextResponse } from 'next/server';
import {
  getRegistrationOptions,
  verifyRegistration,
} from '@/server/auth/passkey';
import { getSession } from '@/server/auth/session';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) ?? {};
  const { email, response, visitorId } = body;

  if (!visitorId) {
    return NextResponse.json(
      { message: 'Visitor ID required' },
      { status: 400 },
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { message: 'Authentication required' },
      { status: 401 },
    );
  }

  if (email && email !== session.email) {
    return NextResponse.json(
      { message: 'Email does not match current user' },
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
    return NextResponse.json({ message: message }, { status: 400 });
  }
}
