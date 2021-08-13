/**
 * Hook into Chrome for Android's media session
 * https://developers.google.com/web/updates/2015/07/media-notifications
 * https://developers.google.com/web/updates/2017/02/media-session
 */

import { Dispatch } from 'react';
import { Howl } from 'howler/src/howler.core';
import { IEpisodeInfo, IPodcastEpisodesInfo } from '../../types';
import {
  PlayerActions,
  resumeEpisode,
  seekBackward,
  seekForward,
  seekTo,
  setPlayerState,
  skipToNextEpisode,
  skipToPreviousEpisode,
} from './context';

export const updatePlaybackHandlers = (
  episode: IEpisodeInfo,
  info: IPodcastEpisodesInfo | null,
  dispatch: Dispatch<PlayerActions>,
) => {
  if (
    typeof window === 'undefined' ||
    typeof window.navigator === 'undefined' ||
    typeof window.navigator.mediaSession === 'undefined'
  ) {
    return;
  }
  const { mediaSession } = window.navigator;

  const { title, author, episodeArt, cover } = episode;

  const artwork = episodeArt || cover || ((info && info.cover) as string);

  mediaSession.metadata = new window.MediaMetadata({
    album: (info && info.title) || title,
    artist: author || ((info && info.author) as string),
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

  const actionsAndHandlers = [
    ['play', () => dispatch(resumeEpisode(episode))],
    ['pause', () => dispatch(setPlayerState('paused'))],
    ['stop', () => dispatch(setPlayerState('idle'))],
    ['seekbackward', () => dispatch(seekBackward())],
    ['seekforward', () => dispatch(seekForward())],
    ['seekto', (details: MediaSessionActionDetails) => dispatch(seekTo(details.seekTime || 0))],
    ['previoustrack', () => dispatch(skipToPreviousEpisode())],
    ['nexttrack', () => dispatch(skipToNextEpisode())],
  ] as const;

  actionsAndHandlers.forEach(([action, handler]) => {
    try {
      mediaSession.setActionHandler(action, handler);
    } catch (error) {
      console.log(`The media session action, ${action}, is not supported`);
    }
  });
};

export const updatePlaybackState = (howl: Howl | null) => {
  if (
    !howl ||
    typeof window === 'undefined' ||
    typeof window.navigator === 'undefined' ||
    typeof window.navigator.mediaSession === 'undefined' ||
    typeof window.navigator.mediaSession.playbackState !== 'function'
  ) {
    return;
  }
  const { mediaSession } = window.navigator;
  try {
    mediaSession.playbackState?.({
      duration: howl.duration(),
      playbackRate: howl.rate() || 1,
      position: howl.seek() || 0,
    });
  } catch (err) {
    console.error('Cannot set playback state', err);
  }
};
