import { useEffect, useState } from 'react';
import { getValue, IStoreable, removeValue, setValue } from './storage';

export function useStorage<K extends keyof IStoreable>(
  key: K,
  defaultValue: IStoreable[K] | null = null,
) {
  const [state, setState] = useState(() => getValue(key) ?? defaultValue);

  useEffect(() => {
    if (!state) {
      removeValue(key);
      return;
    }
    setValue(key, state);
  }, [key, state]);

  return [state, setState] as const;
}
