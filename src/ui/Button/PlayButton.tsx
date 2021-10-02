import { forwardRef, useCallback, memo } from 'react';
import {
  getCurrentEpisode,
  getPlaybackState,
  IPlayerState,
  usePlayer,
} from '../../shared/player/usePlayer';

import { IEpisodeInfo } from '../../types';
import { Button, ButtonProps } from './Button';

export interface PlayButtonProps extends ButtonProps {
  episode: IEpisodeInfo;
  children?: (props: { isCurrentEpisode: boolean; isPlaying: boolean }) => JSX.Element;
}

export const PlayButton = memo(
  forwardRef<HTMLButtonElement, PlayButtonProps>(function PlayButton(
    { episode, children = PlayButtonContent, ...props },
    ref,
  ) {
    const state = usePlayer(getPlaybackState);
    const isCurrentEpisode = usePlayer(useCallback(selectIsCurrentEpisode(episode), [episode]));
    const isPlaying = isCurrentEpisode && (state === 'playing' || state === 'buffering');

    const play = usePlayer(selectPlay);
    const resume = usePlayer(selectResume);
    const setPlayerState = usePlayer(selectSetPlayerState);

    const handleClick = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        if (!isCurrentEpisode) return play(episode);
        if (isPlaying) {
          return setPlayerState('paused');
        } else {
          return resume();
        }
      },
      [episode, isPlaying, play, resume, setPlayerState],
    );

    return (
      <Button {...props} ref={ref} onClick={handleClick} data-is-current={isCurrentEpisode}>
        {children({ isCurrentEpisode, isPlaying })}
      </Button>
    );
  }),
);

const PlayButtonContent = (props: { isCurrentEpisode: boolean; isPlaying: boolean }) => {
  const { isCurrentEpisode, isPlaying } = props;
  return isCurrentEpisode ? (isPlaying ? 'Pause' : 'Resume') : 'Play';
};

const selectIsCurrentEpisode = (episode: IEpisodeInfo) => (playerState: IPlayerState) =>
  getCurrentEpisode(playerState)?.guid === episode.guid && playerState.state !== 'idle';
const selectPlay = (playerState: IPlayerState) => playerState.playEpisode;
const selectResume = (playerState: IPlayerState) => playerState.resumeEpisode;
const selectSetPlayerState = (playerState: IPlayerState) => playerState.setPlayerState;
