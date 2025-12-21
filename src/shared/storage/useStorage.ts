import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { getValue, type IStoreable, removeValue, setValue } from './local';

type StoredValue<T> = [T, Dispatch<SetStateAction<T>>];

export function useStorage<K extends keyof IStoreable>(key: K): StoredValue<IStoreable[K] | null>;
export function useStorage<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K],
): StoredValue<IStoreable[K]>;
export function useStorage<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K] | null = null,
) {
  const [state, setState] = useState(() => getValue(key, defaultValue));

  useEffect(() => {
    if (!state) {
      removeValue(key);
      return;
    }
    setValue(key, state);
  }, [key, state]);

  return [state, setState] as const;
}
