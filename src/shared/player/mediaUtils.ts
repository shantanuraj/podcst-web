/**
 * Hook into Chrome for Android's media session
 * https://developers.google.com/web/updates/2015/07/media-notifications
 * https://developers.google.com/web/updates/2017/02/media-session
 */

import { IEpisodeInfo, IPodcastEpisodesInfo } from '../../types';

export const updateMetadata = (
  episode: IEpisodeInfo,
  info: IPodcastEpisodesInfo | null,
  pause: () => void,
  resume: () => void,
  stop: () => void,
  seekBack: () => void,
  seekForward: () => void,
  seekTo: (seconds: number) => void,
) => {
  if (typeof window === 'undefined' || typeof window.navigator === 'undefined') return;

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

  mediaSession.setActionHandler('play', resume);
  mediaSession.setActionHandler('pause', pause);
  mediaSession.setActionHandler('stop', stop);
  mediaSession.setActionHandler('seekbackward', seekBack);
  mediaSession.setActionHandler('seekforward', seekForward);
  mediaSession.setActionHandler('seekto', (details) => seekTo(details.seekTime || 0));
  mediaSession.setActionHandler('previoustrack', seekForward);
  mediaSession.setActionHandler('nexttrack', seekForward);
};
