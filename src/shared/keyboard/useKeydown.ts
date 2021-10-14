import React from 'react';
import { IShortcutInfo } from './shortcuts';

type ShortcutHandler = (e: KeyboardEvent) => void;
export type KeyboardShortcuts = Array<[IShortcutInfo, ShortcutHandler]>;

export function useKeydown(shortcuts: KeyboardShortcuts): void;
export function useKeydown(config: IShortcutInfo, handler: ShortcutHandler): void;
export function useKeydown(
  shortcutsOrConfig: KeyboardShortcuts | IShortcutInfo,
  handler?: ShortcutHandler,
): void {
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

const isMatchingEvent = (e: KeyboardEvent, config: IShortcutInfo) => {
  return e.metaKey === config.metaKey && (e.key === config.key || config.key === '*');
};
