export const get = async <T>(
  endpoint: string,
  params: Record<string, unknown>,
  revalidate?: number,
): Promise<T> => {
  const url = new URL('https://www.podcst.app/api' + endpoint);
  Object.keys(params).forEach((key) => {
    url.searchParams.append(key, params[key] as string);
  });
  const response = await fetch(url.toString(), {
    next: {
      revalidate,
    },
  });
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json as T;
  } catch (e) {
    console.error('Parse exception', `Response: ${text}.`, url.toString(), response.status);
    throw e;
  }
};
