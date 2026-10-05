import { useThemeStore } from '@/shared/theme/useTheme';
import { shortcuts } from './shortcuts';
import { type KeyboardShortcuts, useKeydown } from './useKeydown';

export function useGlobalShortcuts() {
  useKeydown(globalShortcuts);
}

const globalShortcuts: KeyboardShortcuts = (router) => [
  [shortcuts.home, () => router.push('/feed/top')],
  [shortcuts.subscriptions, () => router.push('/subs')],
  [shortcuts.settings, () => router.push('/account')],
  [shortcuts.shortcuts, () => router.push('/account#shortcuts')],
  [shortcuts.theme, () => useThemeStore.getState().toggle()],
];
