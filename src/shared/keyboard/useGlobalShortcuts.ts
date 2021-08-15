import router from 'next/router';
import { useTheme } from '../theme/useTheme';
import { IShortcutInfo, shortcuts } from './shortcuts';
import { useKeydown } from './useKeydown';

export function useGlobalShortcuts() {
  useKeydown(globalShortcuts);
}

const { cycleTheme } = useTheme.getState();

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
  [shortcuts.theme, cycleTheme],
];
