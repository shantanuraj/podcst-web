import { PlayerState } from "../../types";

export const getAdaptedPlaybackState = (remoteState: chrome.cast.media.PlayerState | null): PlayerState => {
  if (!remoteState) return 'idle';
  return remoteState.toLowerCase() as PlayerState;
}

export const isChromecastConnected = (castState: cast.framework.CastState | undefined): boolean => {
  if (!('cast' in window)) return false;
  return castState === cast.framework.CastState.CONNECTED;
}