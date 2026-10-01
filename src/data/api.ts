function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.FLY_APP_NAME)
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => {
    throw new Error('Invalid API response');
  });
  if (!response.ok)
    throw new Error(data.message || data.error || 'Request failed');
  return data as T;
}

export async function get<T>(
  endpoint: string,
  params: Record<string, unknown>,
  revalidate?: number,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    query.set(key, String(value));
  return responseData<T>(
    await fetch(`${getBaseUrl()}/api${endpoint}?${query}`, {
      next: { revalidate },
    }),
  );
}

export async function post<T>(endpoint: string, body: unknown): Promise<T> {
  return responseData<T>(
    await fetch(`${getBaseUrl()}/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }),
  );
}
