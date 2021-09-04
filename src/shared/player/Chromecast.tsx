import React, { useEffect } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import { getChromecastState, getIsChromecastEnabled, getPlayOnChromecast, getSetChromecastState, usePlayer } from './usePlayer';

export const Chromecast = () => {
  const isChromecastEnabled = usePlayer(getIsChromecastEnabled);
  const chromecastState = usePlayer(getChromecastState);
  const setChromecastState = usePlayer(getSetChromecastState);
  const playOnChromecast = usePlayer(getPlayOnChromecast);

  useEffect(() => {
    if (!('cast' in window)) return;
    const chromecastStateListener = (event: cast.framework.CastStateEventData) => {
      setChromecastState(event.castState);
    }

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
  }, []);

  if (
    !isChromecastEnabled ||
    typeof window === 'undefined' ||
    !('cast' in window) ||
    chromecastState === cast.framework.CastState.NO_DEVICES_AVAILABLE
  )
    return null;

  return (
    <button onClick={playOnChromecast}>
      {chromecastState === cast.framework.CastState.CONNECTED ? (
        <Icon icon="chromecast-connected" />
      ) : (
        <Icon icon="chromecast" />
      )}
    </button>
  );
};
