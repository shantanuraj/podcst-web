/**
 * Episode view
 */

import * as React from 'react';

import { Link } from 'react-router-dom';

import { media, style } from 'typestyle';

import { getEpisodeRoute, monthName } from '../utils';

import ConnectedPlayButton from '../containers/ConnectedPlayButton';

const listItem = (theme: App.ITheme) =>
  style(
    {
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 32,
      paddingRight: 32,
      $nest: {
        '&:nth-child(even)': {
          backgroundColor: theme.backgroundLight,
        },
      },
    },
    media({ maxWidth: 600 }, { paddingLeft: 0, paddingRight: 16 }),
  );

const episodeContainer = (theme: App.ITheme) =>
  style({
    flex: 1,
    color: theme.text,
  });

const episodeRow = style({
  display: 'flex',
  justifyContent: 'space-between',
});

const container = style({
  display: 'flex',
  alignItems: 'center',
});

const episodeImage = style({
  height: 84,
  width: 84,
  objectFit: 'cover',
  objectPosition: 'center',
});

const episodeTitle = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
});

const subContainer = (theme: App.ITheme) =>
  style({
    marginLeft: 16,
    marginRight: 16,
    color: theme.subTitle,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    $nest: {
      '& > p': {
        margin: 4,
      },
    },
  });

interface IEpisodeRowProps {
  episode: App.IEpisodeInfo;
  isCurrentEpisode: boolean;
  theme: App.ITheme;
  play: () => void;
}

const EpisodeRow = (props: IEpisodeRowProps) => {
  const { isCurrentEpisode, episode, play, theme } = props;

  const { cover, episodeArt, feed, title, published, duration } = episode;

  const pub = new Date(published || Date.now());
  const day = pub.getDate();
  const month = monthName(pub.getMonth());
  const minutes = Math.floor((duration || 0) / 60);
  const minutesSuffix = `min${minutes > 0 ? 's' : ''}`;
  const subContainerTheme = subContainer(theme);

  return (
    <li className={listItem(theme)}>
      <img className={episodeImage} src={episodeArt || cover} alt={title} />
      <div className={episodeContainer(theme)}>
        <div className={episodeRow}>
          <div className={container}>
            <div className={subContainerTheme}>
              <p>{month}</p>
              <p>{day}</p>
            </div>
          </div>
          <Link className={episodeTitle} href={getEpisodeRoute(feed, title)}>
            {title}
          </Link>
          <div className={subContainerTheme}>
            <p>{minutes || ''}</p>
            <p>{minutes ? minutesSuffix : ''}</p>
          </div>
          <div className={container}>
            <ConnectedPlayButton isCurrentEpisode={isCurrentEpisode} play={play} />
          </div>
        </div>
      </div>
    </li>
  );
};

export default EpisodeRow;
