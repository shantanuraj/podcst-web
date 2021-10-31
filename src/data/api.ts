export const get = async <T>(endpoint: string, params: Record<string, unknown>): Promise<T> => {
  const url = new URL('https://data.podcst.io' + endpoint);
  Object.keys(params).forEach((key) => {
    url.searchParams.append(key, params[key] as string);
  });
  const response = await fetch(url.toString());
  const text = await response.text();
  const json = JSON.parse(text);
  return json as T;
}
