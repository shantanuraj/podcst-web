import React, { useEffect } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import { getAdaptedPlaybackState } from './castUtils';
import {
  getChromecastState,
  getIsChromecastEnabled,
  getPlayOnChromecast,
  getRemotePlayerController,
  getSetChromecastState,
  getSetDuration,
  getSetPlayerState,
  getSetSeekPosition,
  usePlayer,
} from './usePlayer';

export const Chromecast = () => {
  const isChromecastEnabled = usePlayer(getIsChromecastEnabled);
  const chromecastState = usePlayer(getChromecastState);
  const setChromecastState = usePlayer(getSetChromecastState);
  const playOnChromecast = usePlayer(getPlayOnChromecast);

  const controller = usePlayer(getRemotePlayerController);
  const setSeekPosition = usePlayer(getSetSeekPosition);
  const setDuration = usePlayer(getSetDuration);
  const setPlayerState = usePlayer(getSetPlayerState);

  useEffect(() => {
    if (!('cast' in window)) return;
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
  }, []);

  useEffect(() => {
    if (!controller) return;
    const chromecastStateSync = (event: cast.framework.RemotePlayerChangedEvent) => {
      switch (event.field) {
        case 'currentTime':
          return setSeekPosition(event.value);
        case 'mediaInfo': {
          const mediaInfo = event.value as chrome.cast.media.MediaInfo;
          if (!mediaInfo) return;
          if (typeof mediaInfo.duration === 'number') setDuration(mediaInfo.duration);
          return;
        }
        case 'playerState': {
          const remoteState = event.value as chrome.cast.media.PlayerState;
          const playerState = getAdaptedPlaybackState(remoteState);
          if (playerState !== 'buffering') setPlayerState(playerState);
          return;
        }
      }
    };
    controller.addEventListener(
      cast.framework.RemotePlayerEventType.ANY_CHANGE,
      chromecastStateSync,
    );
    return () => {
      controller.removeEventListener(
        cast.framework.RemotePlayerEventType.ANY_CHANGE,
        chromecastStateSync,
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
