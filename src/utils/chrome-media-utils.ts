/**
 * Hook into Chrome for Android's media session
 * https://developers.google.com/web/updates/2015/07/media-notifications
 * https://developers.google.com/web/updates/2017/02/media-session
 */

export const updateMetadata = (episode: App.Episode) => {
  const {
    mediaSession,
  } = navigator as ChromeNavigator;

  const {
    title,
    author,
    episodeArt,
    cover,
  } = episode;

  mediaSession.metadata = new MediaMetadata({
    title,
    artist: author as string,
    album: author as string,
    artwork: [
      { src: (episodeArt || cover) as string,  sizes: '96x96',   type: 'image/png' },
      { src: (episodeArt || cover) as string, sizes: '128x128', type: 'image/png' },
      { src: (episodeArt || cover) as string, sizes: '192x192', type: 'image/png' },
      { src: (episodeArt || cover) as string, sizes: '256x256', type: 'image/png' },
      { src: (episodeArt || cover) as string, sizes: '384x384', type: 'image/png' },
      { src: (episodeArt || cover) as string, sizes: '512x512', type: 'image/png' },
    ],
  });
};
