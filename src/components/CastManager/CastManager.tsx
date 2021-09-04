import React, { useCallback } from 'react';
import { getSetIsChromecastEnabled, usePlayer } from '../../shared/player/usePlayer';

export const CastManager: React.FC = () => {
  const setIsChromecastEnabled = usePlayer(getSetIsChromecastEnabled);
  const onChromecastEnabled = useCallback(() => setIsChromecastEnabled(true), []);
  React.useEffect(() => {
    document.addEventListener('cast-available', onChromecastEnabled);
    return () => {
      document.removeEventListener('cast-available', onChromecastEnabled);
    };
  }, []);
  return null;
};
