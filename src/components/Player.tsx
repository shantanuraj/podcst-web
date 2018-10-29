/**
 * Player component
 */

import * as React from 'react';

import { media, style } from 'typestyle';

import { Link } from 'react-router-dom';

import { App } from '../typings';

import { IPlayerState, SeekDirection } from '../stores/player';

import { getEpisodeRoute } from '../utils';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

import Icon from '../svg/Icon';

import PlayerInfo from './PlayerInfo';

import ConnectedLargeSeekbar from '../containers/ConnectedLargeSeekbar';

import ConnectedSeekView from '../containers/ConnectedSeekView';

const playerContainer = style(
  {
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    bottom: 0,
    left: 0,
    height: DESKTOP_PLAYER_HEIGHT * 2,
    width: '100%',
    zIndex: 500,
    boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
    transform: `translateY(${DESKTOP_PLAYER_HEIGHT * 2}px)`,
    transition: 'all 0.3s ease',
    $nest: {
      '&[data-is-player-visible]': {
        transform: `translateY(${DESKTOP_PLAYER_HEIGHT}px)`,
      },
    },
  },
  media(
    { maxWidth: 600 },
    {
      height: MOBILE_PLAYER_HEIGHT * 2,
      transform: `translateY(${MOBILE_PLAYER_HEIGHT * 2}px)`,
      $nest: {
        '&[data-is-player-visible]': {
          transform: `translateY(${MOBILE_PLAYER_HEIGHT}px)`,
        },
        '&[data-is-seek-visible]': {
          transform: `translateY(0px)`,
        },
      },
    },
  ),
);

const player = (theme: App.ITheme) =>
  style(
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      height: DESKTOP_PLAYER_HEIGHT,
      width: '100%',
      fontSize: 20,
      color: theme.text,
      $nest: {
        '& [data-display-on-hover]': {
          opacity: 0,
        },
        '&:hover [data-display-on-hover]': {
          opacity: 1,
        },
      },
    },
    media(
      { maxWidth: 600 },
      {
        height: MOBILE_PLAYER_HEIGHT,
      },
    ),
  );

const infoIcon = style({
  position: 'absolute',
  top: 8,
  right: 8,
  opacity: 0,
  zIndex: 1,
  transition: 'all 0.3s ease',
  $nest: {
    '&[data-is-seek-visible]': {
      opacity: 1,
    },
  },
});

interface IPlayerProps extends IPlayerState {
  theme: App.ITheme;
  duration: never;
  seekPosition: never;
  jumpSeek: (seekDirection: SeekDirection) => void;
  onSeek: (seekPosition: number, duration: number) => void;
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
  toggleLargeSeek: () => void;
}

const Player = ({
  currentEpisode,
  isLargeSeekVisible,
  jumpSeek,
  pause,
  queue,
  resume,
  state,
  theme,
  toggleLargeSeek,
}: IPlayerProps) => {
  const episode = queue[currentEpisode];

  const isVisible = state !== 'stopped' && !!episode;

  return isVisible ? (
    <div data-is-seek-visible={isLargeSeekVisible} data-is-player-visible={isVisible} className={playerContainer}>
      <div className={player(theme)}>
        <PlayerInfo
          episode={episode}
          jumpSeek={jumpSeek}
          pause={pause}
          resume={resume}
          state={state}
          theme={theme}
          toggleLargeSeek={toggleLargeSeek}
        />
        <ConnectedSeekView />
        <Link
          data-is-seek-visible={isLargeSeekVisible}
          className={infoIcon}
          href={getEpisodeRoute(episode.feed, episode.title)}
        >
          <Icon color={theme.accent} icon="info" size={24} />
        </Link>
      </div>
      <ConnectedLargeSeekbar mode="inline" />
    </div>
  ) : (
    <div data-is-player-visible={isVisible} className={playerContainer} />
  );
};

export default Player;
