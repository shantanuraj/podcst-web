import { ACCOUNT_OPERATION_PENDING } from '@/shared/account-erasure';
import { AuthError } from '../auth/error';
import { authHeaders, readAuthBody } from '../auth/http';
import { permitsMutation } from '../auth/request';
import { ERASURE_RETRY_SECONDS } from './journal-contract';
import type { createErasureService } from './service';

type Service = ReturnType<typeof createErasureService>;
type Session = Parameters<Service['prepare']>[0];

export function createErasureHandlers({
  service,
  session,
  limit,
  clearSession,
}: {
  service: () => Service;
  session: () => Promise<Session | null>;
  limit: (
    request: Request,
    kind: 'send' | 'verify' | 'challenge',
    subject: string,
  ) => Promise<void>;
  clearSession: () => Promise<void>;
}) {
  const respond = async (request: Request, action: () => Promise<unknown>) => {
    try {
      if (!permitsMutation(request))
        throw new AuthError(403, 'Request origin refused');
      const result = await action();
      const pending =
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'pending';
      return Response.json(
        pending ? { ...result, message: ACCOUNT_OPERATION_PENDING } : result,
        {
          status: pending ? 202 : 200,
          headers: {
            ...authHeaders,
            ...(pending
              ? { 'Retry-After': String(ERASURE_RETRY_SECONDS) }
              : {}),
          },
        },
      );
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof AuthError
              ? error.message
              : 'Account operation unavailable',
        },
        {
          status: error instanceof AuthError ? error.status : 503,
          headers: {
            ...authHeaders,
            ...(error instanceof AuthError && error.retryAfter
              ? { 'Retry-After': String(error.retryAfter) }
              : {}),
          },
        },
      );
    }
  };
  const signedIn = async () => {
    const user = await session();
    if (!user) throw new AuthError(401, 'Authentication required');
    return user;
  };
  const body = async (request: Request, fields: string[]) => {
    const parsed = await readAuthBody(request);
    if (Object.keys(parsed).sort().join(',') !== fields.sort().join(','))
      throw new AuthError(400, 'Invalid account operation');
    return parsed;
  };
  return {
    prepare: (request: Request) =>
      respond(request, async () => {
        const user = await signedIn();
        await body(request, []);
        await limit(request, 'send', user.email);
        return service().prepare(user);
      }),
    erase: (request: Request) =>
      respond(request, async () => {
        const user = await signedIn();
        const value = await body(request, ['operationId', 'code', 'confirmed']);
        if (
          typeof value.operationId !== 'string' ||
          typeof value.code !== 'string' ||
          value.confirmed !== true
        )
          throw new AuthError(400, 'Invalid account operation');
        await limit(request, 'verify', user.email);
        const result = await service().accept(
          user,
          value.operationId,
          value.code,
          true,
        );
        if (result.status === 'completed') await clearSession();
        return result;
      }),
    status: (request: Request) =>
      respond(request, async () => {
        await limit(request, 'challenge', 'erasure-receipt');
        const value = await body(request, ['receipt']);
        if (typeof value.receipt !== 'string')
          throw new AuthError(400, 'Invalid account operation');
        return service().status(value.receipt);
      }),
    revoke: (request: Request, credentialId: string) =>
      respond(request, async () => {
        const user = await signedIn();
        return service().revoke(user, credentialId);
      }),
  };
}
