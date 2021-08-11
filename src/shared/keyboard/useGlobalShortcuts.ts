import router from 'next/router';
import { IShortcutInfo, shortcuts } from './shortcuts';
import { useKeydown } from './useKeydown';

export function useGlobalShortcuts() {
  useKeydown(globalShortcuts);
}

const globalShortcuts: Array<[IShortcutInfo, () => void]> = [
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
