import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
