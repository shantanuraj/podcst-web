import { useTheme } from '@/shared/theme/useTheme';
import { shortcuts } from './shortcuts';
import { KeyboardShortcuts, useKeydown } from './useKeydown';

export function useGlobalShortcuts() {
  useKeydown(globalShortcuts);
}

const { cycleTheme } = useTheme.getState();

const globalShortcuts: KeyboardShortcuts = (router) => [
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
  [
    shortcuts.shortcuts,
    () => {
      router.push('/settings/shortcuts');
    },
  ],
  [shortcuts.theme, cycleTheme],
];
