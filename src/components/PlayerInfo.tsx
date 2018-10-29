/**
 * Player Info bar
 */

/* tslint:disable:no-console */

import * as React from 'react';

import { Link } from 'react-router-dom';

import { classes, media, style } from 'typestyle';

import { App, EpisodePlayerState } from '../typings';

import Icon from '../svg/Icon';

import SeekButton from './SeekButton';

import { SeekDirection } from '../stores/player';

import { getEpisodeRoute, getEpisodesRoute } from '../utils';

import { DESKTOP_PLAYER_HEIGHT, MAIN_ICON_RATIO, MOBILE_PLAYER_HEIGHT, SUB_ICON_RATIO } from '../utils/constants';

const infoContainer = (theme: App.ITheme) =>
  style(
    {
      height: '100%',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      backgroundColor: theme.background,
    },
    media(
      { maxWidth: 600 },
      {
        boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
      },
    ),
  );

const linkContainer = style({
  height: '100%',
  display: 'flex',
  border: 0,
  padding: 0,
  outline: 0,
});

const showLink = style({
  flex: 1,
  $nest: {
    '& > div': {
      flex: 1,
    },
  },
});

const episodeImage = (image: string) =>
  style(
    {
      backgroundImage: `url(${image})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      height: 'inherit',
      width: DESKTOP_PLAYER_HEIGHT,
    },
    media(
      { maxWidth: 600 },
      {
        width: MOBILE_PLAYER_HEIGHT,
      },
    ),
  );

const episodeInfoContainer = style({
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  paddingRight: 16,
});

const episodeInfo = (theme: App.ITheme) =>
  style(
    {
      $nest: {
        '& p': {
          textAlign: 'left',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
        },
        '& [data-title]': {
          color: theme.text,
          fontSize: 16,
        },
        '& [data-author]': {
          color: theme.subTitle,
          marginTop: 16,
          fontSize: 15,
          fontWeight: 'lighter',
        },
      },
    },
    media(
      { maxWidth: 600 },
      {
        $nest: {
          '& [data-author]': {
            marginTop: 8,
          },
        },
      },
    ),
  );

const buttonsContainer = style({
  height: '100%',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
});

export const playerButton = (sizeRatio: number) =>
  style(
    {
      width: Math.round(DESKTOP_PLAYER_HEIGHT * sizeRatio),
      background: 'inherit',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      outline: 0,
      padding: 0,
    },
    media(
      { maxWidth: 600 },
      {
        width: Math.round(MOBILE_PLAYER_HEIGHT * sizeRatio),
      },
    ),
  );

interface IPlayerInfoProps {
  episode: App.IEpisodeInfo;
  state: EpisodePlayerState;
  theme: App.ITheme;
  jumpSeek: (direction: SeekDirection) => void;
  pause();
  resume();
  toggleLargeSeek();
}

const PlayerInfo = ({
  episode: { author, cover, feed, episodeArt, title },
  jumpSeek,
  pause,
  resume,
  state,
  theme,
  toggleLargeSeek,
}: IPlayerInfoProps) => (
  <div className={infoContainer(theme)}>
    <Link className={linkContainer} to={getEpisodesRoute(feed)}>
      <div className={episodeImage(episodeArt || cover)} role="img" aria-label={`${title} episode art`} />
    </Link>
    <div className={buttonsContainer}>
      <SeekButton
        direction="seek-back"
        hideOnMobile={true}
        label="Seek Back 10 seconds"
        onClick={() => jumpSeek('seek-back')}
        sizeRatio={SUB_ICON_RATIO}
        theme={theme}
      />
      <button
        role="button"
        aria-label={state === 'playing' ? 'Pause' : 'Play'}
        className={playerButton(MAIN_ICON_RATIO)}
        onClick={state === 'playing' ? pause : resume}
      >
        <Icon color={theme.accent} icon={state === 'playing' ? 'pause' : 'play'} size="100%" />
      </button>
      <SeekButton
        direction="seek-forward"
        hideOnMobile={true}
        label="Seek Forward 10 seconds"
        onClick={() => jumpSeek('seek-forward')}
        sizeRatio={SUB_ICON_RATIO}
        theme={theme}
      />
    </div>
    <Link data-hide-on-mobile="true" className={classes(linkContainer, showLink)} to={getEpisodeRoute(feed, title)}>
      <div className={episodeInfoContainer}>
        <div className={episodeInfo(theme)}>
          <p data-title="true">{title}</p>
          <p data-author="true">{author}</p>
        </div>
      </div>
    </Link>
    <button data-hide-on-desktop="true" className={classes(linkContainer, showLink)} onClick={toggleLargeSeek}>
      <div className={episodeInfoContainer}>
        <div className={episodeInfo(theme)}>
          <p data-title="true">{title}</p>
          <p data-author="true">{author}</p>
        </div>
      </div>
    </button>
  </div>
);

export default PlayerInfo;
