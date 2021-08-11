import axios from 'axios';

const api = axios.create({
  baseURL: 'https://data.podcst.io',
});

export const get = <T>(url: string, params: Record<string, unknown> = {}): Promise<T> =>
  api.get<T>(url, { params }).then((res) => res.data);
