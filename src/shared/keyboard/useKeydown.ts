import React from 'react';

import { IKeyboardShortcut, IShortcutInfo } from './shortcuts';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context';
import { useRouter } from 'next/navigation';

type ShortcutHandler = (e: KeyboardEvent) => void;
export type KeyboardShortcuts = (
  router: AppRouterInstance,
) => Array<[IShortcutInfo, ShortcutHandler]>;

export function useKeydown(shortcuts: KeyboardShortcuts): void;
export function useKeydown(config: IShortcutInfo, handler: ShortcutHandler): void;
export function useKeydown(
  arg: KeyboardShortcuts | IShortcutInfo,
  handler?: ShortcutHandler,
): void {
  const router = useRouter();
  const shortcutsOrConfig = typeof arg === 'function' ? arg(router) : arg;
  const safeHandler = React.useCallback(
    (e: KeyboardEvent) => {
      if (isNotIgnoreElement(e.target)) {
        if (Array.isArray(shortcutsOrConfig)) {
          shortcutsOrConfig.forEach(([shortcut, handler]) => {
            if (isMatchingEvent(e, shortcut)) {
              handler(e);
            }
          });
        } else if (handler && isMatchingEvent(e, shortcutsOrConfig)) {
          handler(e);
        }
      }
    },
    [handler, shortcutsOrConfig],
  );

  React.useEffect(() => {
    document.addEventListener('keydown', safeHandler);
    return () => document.removeEventListener('keydown', safeHandler);
  }, [shortcutsOrConfig, handler]);
}

/**
 * Element selector for ignoring keyboard events
 */
const ignoreKeyboardSelector = 'input,select,textarea,a,button,[role="button"]';

/**
 * Boolean check for ignore selector
 */
const isNotIgnoreElement = (target: EventTarget | null) =>
  !!target && !(target as HTMLElement).matches(ignoreKeyboardSelector);

const isMatchingShortcut = (e: KeyboardEvent, config: IKeyboardShortcut) => {
  return (
    e.metaKey === config.metaKey &&
    e.shiftKey === config.shiftKey &&
    (e.key === config.key || config.key === '*')
  );
};

const isMatchingEvent = (e: KeyboardEvent, config: IShortcutInfo) => {
  return (
    isMatchingShortcut(e, config) ||
    config.secondary?.some((shortcut) => isMatchingShortcut(e, shortcut)) ||
    false
  );
};
