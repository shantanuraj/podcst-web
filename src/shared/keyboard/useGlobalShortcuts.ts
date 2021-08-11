import router from 'next/router';
import { shortcuts } from './shortcuts';
import { useKeydown } from './useKeydown';

export function useGlobalShortcuts() {
  useKeydown(globalHandler);
}

const handlers = {
  [shortcuts.home.value]: () => {
    router.push('/feed/top');
  },
  [shortcuts.subscriptions.value]: () => {
    router.push('/subs');
  },
  [shortcuts.recents.value]: () => {
    router.push('/recents');
  },
  [shortcuts.settings.value]: () => {
    router.push('/settings');
  },
};

const globalHandler = (e: KeyboardEvent) => {
  if (e.metaKey) return;
  const handler = handlers[e.key as keyof typeof handlers];
  handler?.();
};
