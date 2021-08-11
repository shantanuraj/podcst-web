import React from 'react';
import { IShortcutInfo, shortcuts } from './shortcuts';

type ShortcutHandler = () => void;
type KeyboardShortcuts = Array<[IShortcutInfo, ShortcutHandler]>;

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
              handler();
            }
          });
        } else if (handler && isMatchingEvent(e, shortcutsOrConfig)) {
          handler();
        }
      }
    },
    [handler, shortcutsOrConfig],
  );

  React.useEffect(() => {
    document.addEventListener('keydown', safeHandler);
    return () => document.removeEventListener('keydown', safeHandler);
  }, [handler]);
}

/**
 * Element selector for ignoring keyboard events
 */
const ignoreKeyboardSelector = 'input';

/**
 * Boolean check for ignore selector
 */
const isNotIgnoreElement = (target: EventTarget | null) =>
  !!target && !(target as HTMLElement).matches(ignoreKeyboardSelector);

const isMatchingEvent = (e: KeyboardEvent, config: IShortcutInfo) => {
  return e.metaKey === !!config.metaKey && e.key === config.key;
};
