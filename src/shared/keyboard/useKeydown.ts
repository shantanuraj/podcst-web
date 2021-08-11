import React from 'react';

export function useKeydown(handler: (e: KeyboardEvent) => void) {
  React.useEffect(() => {
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handler]);
}
