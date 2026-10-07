import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { limitAuth } from '@/server/auth/backend';
import { AuthError } from '@/server/auth/error';
import { authResponse, readAuthBody } from '@/server/auth/http';
import {
  getDiscoverableAuthOptions,
  verifyAuthentication,
} from '@/server/auth/passkey';
import { setSessionCookie } from '@/server/auth/session';

export const POST = (request: Request) =>
  authResponse(async () => {
    const { discoverable, response, flowId } = await readAuthBody(request);
    if (response === undefined) {
      if (discoverable !== true)
        throw new AuthError(400, 'Passkey flow required');
      await limitAuth(request, 'challenge', '');
      return getDiscoverableAuthOptions();
    }
    if (
      typeof flowId !== 'string' ||
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response)
    )
      throw new AuthError(400, 'Invalid or expired passkey flow');
    await limitAuth(request, 'verify', `passkey:${flowId}`);
    const result = await verifyAuthentication(
      flowId,
      response as AuthenticationResponseJSON,
    );
    await setSessionCookie(result.session);
    return { verified: true, userId: result.userId };
  });
