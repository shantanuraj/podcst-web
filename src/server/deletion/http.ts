import { AuthError } from '../auth/error';
import { authHeaders, readAuthBody } from '../auth/http';
import type { AuthLimitKind } from '../auth/limits';
import { permitsMutation } from '../auth/request';
import type { createDeletionService } from './service';

type Service = ReturnType<typeof createDeletionService>;
export function deletionHandlers({
  service,
  session,
  limit,
}: {
  service: () => Service;
  session: () => Promise<{ id: string; userId: string; email: string } | null>;
  limit: (
    request: Request,
    kind: AuthLimitKind,
    subject: string,
  ) => Promise<void>;
}) {
  const respond = async (
    request: Request,
    fields: string[],
    action: (body: Record<string, unknown>) => Promise<unknown>,
  ) => {
    try {
      if (!permitsMutation(request))
        throw new AuthError(403, 'Request origin refused');
      const body = await readAuthBody(request);
      if (Object.keys(body).sort().join(',') !== fields.sort().join(','))
        throw new AuthError(400, 'Invalid deletion request');
      const result = await action(body);
      const pending =
        !!result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'pending';
      return Response.json(result, {
        status: pending ? 202 : 200,
        headers: {
          ...authHeaders,
          ...(pending ? { 'Retry-After': '10' } : {}),
        },
      });
    } catch (error) {
      return Response.json(
        {
          message:
            error instanceof AuthError
              ? error.message
              : 'Account deletion unavailable; try again',
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
    if (!user) throw new AuthError(401, 'Sign in to delete your account');
    return user;
  };
  return {
    prepare: (request: Request) =>
      respond(request, ['accountId'], async (body) => {
        const user = await signedIn();
        if (typeof body.accountId !== 'string')
          throw new AuthError(400, 'Invalid account');
        await limit(request, 'send', user.email);
        return service().prepare(user, body.accountId);
      }),
    submit: (request: Request) =>
      respond(request, ['operationId', 'code', 'confirmed'], async (body) => {
        const user = await signedIn();
        if (
          typeof body.operationId !== 'string' ||
          typeof body.code !== 'string' ||
          body.confirmed !== true
        )
          throw new AuthError(400, 'Confirm account deletion');
        await limit(request, 'verify', user.email);
        return service().accept(user, body.operationId, body.code, true);
      }),
    status: (request: Request) =>
      respond(request, ['receipt'], async (body) => {
        if (typeof body.receipt !== 'string')
          throw new AuthError(400, 'Invalid deletion receipt');
        await limit(request, 'deletion-status', body.receipt);
        return service().status(body.receipt);
      }),
  };
}
