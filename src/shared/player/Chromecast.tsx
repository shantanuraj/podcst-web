import React, { useEffect } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import { getAdaptedPlaybackState } from './castUtils';
import {
  getChromecastState,
  getIsChromecastEnabled,
  getPlayOnChromecast,
  getRemotePlayerController,
  getSetDuration,
  getSetPlayerState,
  getSetSeekPosition,
  getSyncSeekAndPause,
  usePlayer,
} from './usePlayer';

export const Chromecast = () => {
  const isChromecastEnabled = usePlayer(getIsChromecastEnabled);
  const chromecastState = usePlayer(getChromecastState);
  const playOnChromecast = usePlayer(getPlayOnChromecast);
  const syncSeekAndPause = usePlayer(getSyncSeekAndPause);

  const controller = usePlayer(getRemotePlayerController);
  const setSeekPosition = usePlayer(getSetSeekPosition);
  const setDuration = usePlayer(getSetDuration);
  const setPlayerState = usePlayer(getSetPlayerState);

  useEffect(() => {
    if (!controller) return;
    const chromecastPlaybackStateSync = (event: cast.framework.RemotePlayerChangedEvent) => {
      switch (event.field) {
        case 'currentTime':
          if (event.value) setSeekPosition(event.value);
          return;
        case 'mediaInfo': {
          const mediaInfo = event.value as chrome.cast.media.MediaInfo;
          if (!mediaInfo) return;
          if (typeof mediaInfo.duration === 'number') setDuration(mediaInfo.duration);
          return;
        }
        case 'playerState': {
          const remoteState = event.value as chrome.cast.media.PlayerState;
          const playerState = getAdaptedPlaybackState(remoteState);
          if (playerState === 'idle') syncSeekAndPause();
          else if (playerState !== 'buffering') setPlayerState(playerState);
          return;
        }
      }
    };
    controller.addEventListener(
      cast.framework.RemotePlayerEventType.ANY_CHANGE,
      chromecastPlaybackStateSync,
    );
    return () => {
      controller.removeEventListener(
        cast.framework.RemotePlayerEventType.ANY_CHANGE,
        chromecastPlaybackStateSync,
      );
    };
  }, [controller]);

  if (
    !isChromecastEnabled ||
    typeof window === 'undefined' ||
    !('cast' in window) ||
    chromecastState === cast.framework.CastState.NO_DEVICES_AVAILABLE
  )
    return null;

  return chromecastState === cast.framework.CastState.CONNECTED ? (
    <button onClick={showSelector}>
      <Icon icon="chromecast-connected" />
    </button>
  ) : (
    <button onClick={playOnChromecast}>
      <Icon icon="chromecast" />
    </button>
  );
};

const showSelector = () => {
  const context = cast.framework.CastContext.getInstance();
  context.requestSession();
};
