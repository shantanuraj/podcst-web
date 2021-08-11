import * as React from 'react';
import { PlayerActionsContext } from './context';

export function usePlayerActions() {
  const value = React.useContext(PlayerActionsContext);
  if (!value) {
    throw new Error('usePlayerActions must be used within the PlayerProvider');
  }
  return value;
}
