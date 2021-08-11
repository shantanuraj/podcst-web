import router from 'next/router';
import { IShortcutInfo, shortcuts } from './shortcuts';
import { isMatchingEvent, useKeydown } from './useKeydown';

export function useGlobalShortcuts() {
  useKeydown(globalHandler);
}

const handlers: Array<[IShortcutInfo, () => void]> = [
  [
    shortcuts.home,
    () => {
      router.push('/feed/top');
    },
  ],
  [
    shortcuts.subscriptions,
    () => {
      router.push('/subs');
    },
  ],
  [
    shortcuts.recents,
    () => {
      router.push('/recents');
    },
  ],
  [
    shortcuts.settings,
    () => {
      router.push('/settings');
    },
  ],
];

const globalHandler = (e: KeyboardEvent) => {
  handlers.forEach(([shortcut, handler]) => {
    if (isMatchingEvent(e, shortcut)) {
      handler();
    }
  });
};
