import { validateCatalogue } from './catalogue';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.FLY_APP_NAME)
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const isAccessDenied = (error: unknown) =>
  error instanceof ApiError && [401, 403, 404].includes(error.status);

export async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => {
    throw new ApiError(response.status, 'Invalid API response');
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.message || 'Request failed',
      data.code,
      Number(response.headers.get('Retry-After')) || undefined,
    );
  if (
    /\/api\/(?:feed|progress|subscriptions|search|noteworthy)(?:[/?]|$)/.test(
      response.url,
    )
  )
    validateCatalogue(data);
  return data as T;
}

export async function get<T>(
  endpoint: string,
  params: Record<string, unknown>,
  revalidate?: number,
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    query.set(key, String(value));
  return responseData<T>(
    await fetch(`${getBaseUrl()}/api${endpoint}?${query}`, {
      next: { revalidate },
      signal,
    }),
  );
}

export async function post<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return responseData<T>(
    await fetch(`${getBaseUrl()}/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal,
    }),
  );
}
