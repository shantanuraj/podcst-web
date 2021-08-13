/**
 * Hook into Chrome for Android's media session
 * https://developers.google.com/web/updates/2015/07/media-notifications
 * https://developers.google.com/web/updates/2017/02/media-session
 */

import { Dispatch } from 'react';
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

export const updateMetadata = (
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

  const resume = () => dispatch(resumeEpisode(episode));
  const pause = () => dispatch(setPlayerState('paused'));
  const stop = () => dispatch(setPlayerState('idle'));
  const seekForwardHandler = () => dispatch(seekForward());
  const seekBackHandler = () => dispatch(seekBackward());
  const seekToTimestamp = (seconds: number | null) => dispatch(seekTo(seconds || 0));
  const previousTrack = () => dispatch(skipToPreviousEpisode());
  const nextTrack = () => dispatch(skipToNextEpisode());

  mediaSession.setActionHandler('play', resume);
  mediaSession.setActionHandler('pause', pause);
  mediaSession.setActionHandler('stop', stop);
  mediaSession.setActionHandler('seekbackward', seekBackHandler);
  mediaSession.setActionHandler('seekforward', seekForwardHandler);
  mediaSession.setActionHandler('seekto', (details) => seekToTimestamp(details.seekTime));
  mediaSession.setActionHandler('previoustrack', previousTrack);
  mediaSession.setActionHandler('nexttrack', nextTrack);
};
