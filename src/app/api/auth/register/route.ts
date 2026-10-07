import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { limitAuth } from '@/server/auth/backend';
import { AuthError } from '@/server/auth/error';
import { authResponse, readAuthBody } from '@/server/auth/http';
import {
  getRegistrationOptions,
  verifyRegistration,
} from '@/server/auth/passkey';
import { getSession } from '@/server/auth/session';

export const POST = (request: Request) =>
  authResponse(async () => {
    const session = await getSession();
    if (!session) throw new AuthError(401, 'Authentication required');
    const { response, flowId } = await readAuthBody(request);
    if (response === undefined) {
      await limitAuth(request, 'challenge', session.userId);
      return getRegistrationOptions(session);
    }
    if (
      typeof flowId !== 'string' ||
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response)
    )
      throw new AuthError(400, 'Invalid or expired passkey flow');
    await limitAuth(request, 'verify', session.email);
    return verifyRegistration(
      session,
      flowId,
      response as RegistrationResponseJSON,
    );
  });
