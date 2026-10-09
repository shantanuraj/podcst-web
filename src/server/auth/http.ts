import { BodyError, readJsonBody } from '../http/json-body';
import { AuthError } from './error';

export const AUTH_BODY_LIMIT = 16 * 1024;
export const authHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

export async function readAuthBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await readJsonBody(request, AUTH_BODY_LIMIT, 5000, {});
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyError && error.status === 413)
      throw new AuthError(413, 'Authentication request too large');
    if (error instanceof BodyError && error.status === 408)
      throw new AuthError(408, 'Authentication request timed out');
    throw new AuthError(400, 'Invalid authentication request');
  }
}

export async function authResponse(operation: () => Promise<unknown>) {
  try {
    return Response.json(await operation(), { headers: authHeaders });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof AuthError
            ? error.message
            : 'Authentication unavailable',
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
}

export const isEmail = (value: unknown): value is string =>
  typeof value === 'string' &&
  Buffer.byteLength(value) <= 254 &&
  !/\p{Cc}/u.test(value) &&
  /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

export const isCode = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 6 && /^\d{6}$/.test(value);
