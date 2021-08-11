import { info } from 'console';
import React from 'react';
import { IShortcutInfo } from './shortcuts';

export function useKeydown(handler: (e: KeyboardEvent) => void) {
  const safeHandler = React.useCallback(
    (e: KeyboardEvent) => {
      if (isNotIgnoreElement(e.target)) handler(e);
    },
    [handler],
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

export const isMatchingEvent = (e: KeyboardEvent, config: IShortcutInfo) => {
  return e.metaKey === !!(config.metaKey) && e.key === config.key;
};
