import { useContext } from 'react';
import { PlayerStateContext } from './context';

export function usePlayerState() {
  const value = useContext(PlayerStateContext);
  if (!value) throw Error('usePlayerState must be used within the PlayerProvider');
  return value;
}
