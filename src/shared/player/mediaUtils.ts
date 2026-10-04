/**
 * Hook into Chrome for Android's media session
 * https://developers.google.com/web/updates/2015/07/media-notifications
 * https://developers.google.com/web/updates/2017/02/media-session
 */
import type { IEpisodeInfo } from '@/types';
import type { IPlayerState } from './usePlayer';

export const updatePlaybackMetadata = (
  episode: IEpisodeInfo | undefined,
  podcastTitle?: string,
) => {
  if (
    typeof window === 'undefined' ||
    typeof window.navigator === 'undefined' ||
    typeof window.navigator.mediaSession === 'undefined'
  ) {
    return;
  }
  const { mediaSession } = window.navigator;
  if (!episode) {
    mediaSession.metadata = null;
    mediaSession.playbackState = 'none';
    try {
      mediaSession.setPositionState?.();
    } catch {}
    return;
  }

  const { title, author, episodeArt, cover } = episode;

  const artwork = episodeArt || cover;

  mediaSession.metadata = new window.MediaMetadata({
    album: podcastTitle || title,
    artist: author || podcastTitle,
    artwork: [
      { src: artwork, sizes: '96x96', type: 'image/png' },
      { src: artwork, sizes: '128x128', type: 'image/png' },
      { src: artwork, sizes: '192x192', type: 'image/png' },
      { src: artwork, sizes: '256x256', type: 'image/png' },
      { src: artwork, sizes: '384x384', type: 'image/png' },
      { src: artwork, sizes: '512x512', type: 'image/png' },
    ],
    title,
  });
};

export const updatePlaybackHandlers = (playerState?: IPlayerState) => {
  if (
    typeof window === 'undefined' ||
    typeof window.navigator === 'undefined' ||
    typeof window.navigator.mediaSession === 'undefined'
  ) {
    return;
  }
  const { mediaSession } = window.navigator;

  const actionsAndHandlers = [
    ['play', playerState?.resumeEpisode ?? null],
    ['pause', playerState ? () => playerState.setPlayerState('paused') : null],
    ['stop', playerState ? () => playerState.setPlayerState('idle') : null],
    ['seekbackward', playerState?.seekBackward ?? null],
    ['seekforward', playerState?.seekForward ?? null],
    [
      'seekto',
      playerState
        ? (details: MediaSessionActionDetails) =>
            playerState.seekTo(details.seekTime || 0)
        : null,
    ],
    ['previoustrack', playerState?.skipToPreviousEpisode ?? null],
    ['nexttrack', playerState?.skipToNextEpisode ?? null],
  ] as const;

  actionsAndHandlers.forEach(([action, handler]) => {
    try {
      mediaSession.setActionHandler(action, handler);
    } catch (_error) {
      console.log(`The media session action, ${action}, is not supported`);
    }
  });
};

export const updatePlaybackState = (playbackState: {
  duration: number;
  playbackRate: number;
  position: number;
}) => {
  if (
    typeof window === 'undefined' ||
    typeof window.navigator === 'undefined' ||
    typeof window.navigator.mediaSession === 'undefined' ||
    typeof window.navigator.mediaSession.playbackState !== 'function'
  ) {
    return;
  }
  const { mediaSession } = window.navigator;
  try {
    // @ts-expect-error Outdated typings
    mediaSession.playbackState?.(playbackState);
  } catch (err) {
    console.error('Cannot set playback state', err);
  }
};
