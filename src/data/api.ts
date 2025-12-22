function getBaseUrl() {
  if (typeof window !== 'undefined') {
    return '';
  }
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  if (process.env.FLY_APP_NAME) {
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

export const get = async <T>(
  endpoint: string,
  params: Record<string, unknown>,
  revalidate?: number,
): Promise<T> => {
  const searchParams = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    searchParams.append(key, params[key] as string);
  });
  const url = `${getBaseUrl()}/api${endpoint}?${searchParams.toString()}`;
  const response = await fetch(url, {
    next: {
      revalidate,
    },
  });
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json as T;
  } catch (e) {
    console.error('Parse exception', `Response: ${text}.`, url, response.status);
    throw e;
  }
};
