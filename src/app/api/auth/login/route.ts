import { type NextRequest, NextResponse } from 'next/server';
import {
  checkUserPasskeys,
  getAuthenticationOptions,
  getDiscoverableAuthOptions,
  verifyAuthentication,
} from '@/server/auth/passkey';
import { createSession } from '@/server/auth/session';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) ?? {};
  const { email, response, userId, visitorId, discoverable } = body;

  if (!visitorId) {
    return NextResponse.json(
      { message: 'Visitor ID required' },
      { status: 400 },
    );
  }

  if (!response) {
    if (discoverable) {
      const { options } = await getDiscoverableAuthOptions(visitorId);
      return NextResponse.json({ options });
    }

    if (!email) {
      return NextResponse.json({ message: 'Email required' }, { status: 400 });
    }

    const check = await checkUserPasskeys(email);

    if (!check.exists) {
      return NextResponse.json({ exists: false });
    }

    if (!check.hasPasskey) {
      return NextResponse.json({
        exists: true,
        hasPasskey: false,
        userId: check.userId,
      });
    }

    const { options, userId: uid } = await getAuthenticationOptions(
      email,
      visitorId,
    );
    return NextResponse.json({
      exists: true,
      hasPasskey: true,
      options,
      userId: uid,
    });
  }

  try {
    const result = await verifyAuthentication(visitorId, response, userId);

    if (result.verified && result.userId) {
      await createSession(result.userId);
    }

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Authentication failed';
    return NextResponse.json({ message: message }, { status: 400 });
  }
}
