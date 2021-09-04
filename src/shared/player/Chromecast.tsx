import React, { useEffect, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import AudioUtils from './AudioUtils';

export const Chromecast = () => {
  const [isChromecastEnabled] = useState(AudioUtils.isChromecastEnabled);
  const [chromecastState, setChromecastState] = useState(AudioUtils.getChromecastState);

  useEffect(() => {
    AudioUtils.addChromecastStateListener(setChromecastState);
    return () => AudioUtils.removeChromecastStateListener();
  }, []);

  if (
    !isChromecastEnabled ||
    typeof window === 'undefined' ||
    !('cast' in window) ||
    chromecastState === cast.framework.CastState.NO_DEVICES_AVAILABLE
  )
    return null;

  return (
    <button onClick={AudioUtils.playEpisodeOnChromecast}>
      {chromecastState === cast.framework.CastState.CONNECTED ? (
        <Icon icon="chromecast-connected" />
      ) : (
        <Icon icon="chromecast" />
      )}
    </button>
  );
};
