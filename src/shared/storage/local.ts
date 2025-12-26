import type { Scheme } from '@/shared/theme/useTheme';
import type { ThemeMode } from '@/types';

const STORE_KEY = 'store@4';

export interface IStoreable {
  volume: number;
  themeMode: ThemeMode;
  scheme: Scheme;
  lastSyncTime: number;
}

const storage =
  typeof window !== 'undefined'
    ? window.localStorage
    : {
        setItem(_k: string, _v: string) {},
        getItem(_k: string) {
          return '{}';
        },
        removeItem(_k: string) {},
        clear(_x: string) {},
        length: 0,
      };

const getStore = (): IStoreable =>
  JSON.parse(storage.getItem(STORE_KEY) as string) || {};

export const removeValue = <K extends keyof IStoreable>(key: K) => {
  try {
    const store = getStore();
    delete store[key];
    storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (_err) {
    storage.removeItem(STORE_KEY);
  }
};

export function getValue<K extends keyof IStoreable>(
  key: K,
): IStoreable[K] | null;
export function getValue<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K],
): IStoreable[K];
export function getValue<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K] | null,
): IStoreable[K] | null;
export function getValue<K extends keyof IStoreable>(
  key: K,
  defaultValue = null,
) {
  try {
    const store = getStore();
    return store[key] || defaultValue;
  } catch (_err) {
    removeValue(key);
  }
  return null;
}

export const setValue = <K extends keyof IStoreable>(
  key: K,
  val: IStoreable[K],
) => {
  const store: IStoreable = {
    ...getStore(),
    [key]: val,
  };
  storage.setItem(STORE_KEY, JSON.stringify(store));
};
