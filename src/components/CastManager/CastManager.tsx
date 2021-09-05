import React, { useCallback, useEffect } from 'react';
import {
  getIsChromecastEnabled,
  getSetChromecastState,
  getSetIsChromecastEnabled,
  usePlayer,
} from '../../shared/player/usePlayer';

export const CastManager: React.FC = () => {
  const isChromecastEnabled = usePlayer(getIsChromecastEnabled);
  const setIsChromecastEnabled = usePlayer(getSetIsChromecastEnabled);
  const setChromecastState = usePlayer(getSetChromecastState);
  const onChromecastEnabled = useCallback(() => setIsChromecastEnabled(true), []);
  // Setup cast availability listener
  useEffect(() => {
    document.addEventListener('cast-available', onChromecastEnabled);
    return () => {
      document.removeEventListener('cast-available', onChromecastEnabled);
    };
  }, []);

  // Setup cast state listener
  useEffect(() => {
    if (!('cast' in window) || !isChromecastEnabled) return;
    const chromecastStateListener = (event: cast.framework.CastStateEventData) => {
      setChromecastState(event.castState);
    };

    const context = cast.framework.CastContext.getInstance();
    context.addEventListener(
      cast.framework.CastContextEventType.CAST_STATE_CHANGED,
      chromecastStateListener,
    );

    return () => {
      context.removeEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        chromecastStateListener,
      );
    };
  }, [isChromecastEnabled]);
  return null;
};
