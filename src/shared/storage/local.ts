/**
 * Storage manager
 */

import { ThemeMode } from '@/types';

const STORE_KEY = 'store@4';

const DEPRECATED_KEYS = ['store@3'] as const;

export interface IStoreable {
  volume: number;
  themeMode: ThemeMode;
  lastSyncTime: number;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-empty-function */
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

/**
 * Removes legacy persisted data
 */
export const removeDeprecatedStorage = () =>
  DEPRECATED_KEYS.forEach(storage.removeItem.bind(storage));

const getStore = (): IStoreable => JSON.parse(storage.getItem(STORE_KEY) as string) || {};

export const removeValue = <K extends keyof IStoreable>(key: K) => {
  try {
    const store = getStore();
    delete store[key];
    storage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (err) {
    console.error(`Fatal error couldn't remove key from store purging persisted data`);
    storage.removeItem(STORE_KEY);
  }
};

export function getValue<K extends keyof IStoreable>(key: K): IStoreable[K] | null;
export function getValue<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K],
): IStoreable[K];
export function getValue<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K] | null,
): IStoreable[K] | null;
export function getValue<K extends keyof IStoreable>(key: K, defaultValue = null) {
  try {
    const store = getStore();
    return store[key] || defaultValue;
  } catch (err) {
    console.error(`Couldn't parse persisted store while accessing key: ${key}`, err);
    removeValue(key);
  }
  return null;
}

export const setValue = <K extends keyof IStoreable>(key: K, val: IStoreable[K]) => {
  const store: IStoreable = {
    ...getStore(),
    [key]: val,
  };
  storage.setItem(STORE_KEY, JSON.stringify(store));
};
