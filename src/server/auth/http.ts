import { AuthError } from './error';

export const AUTH_BODY_LIMIT = 16 * 1024;
export const authHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
};

export async function readAuthBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length')) > AUTH_BODY_LIMIT)
    throw new AuthError(413, 'Authentication request too large');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AuthError(408, 'Authentication request timed out'));
      void reader.cancel().catch(() => {});
    }, 5000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > AUTH_BODY_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new AuthError(413, 'Authentication request too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(400, 'Invalid authentication request');
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
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
  typeof value === 'string' && /^\d{6}$/.test(value);
