import * as React from 'react';
import { playEpisode, setPlayerState } from '../../shared/player/context';
import { usePlayerActions } from '../../shared/player/usePlayerActions';
import { usePlayerState } from '../../shared/player/usePlayerState';

import { IEpisodeInfo } from '../../types';
import { Button, ButtonProps } from './Button';

type PlayButtonProps = ButtonProps & {
  episode: IEpisodeInfo;
};

export const PlayButton = React.memo(
  React.forwardRef<HTMLButtonElement, PlayButtonProps>(function PlayButton(
    { episode, ...props },
    ref,
  ) {
    const { queue, currentTrackIndex, state } = usePlayerState();
    const isCurrentEpisode = queue[currentTrackIndex]?.guid === episode.guid;
    const isPlaying = isCurrentEpisode && state === 'playing';

    const dispatch = usePlayerActions();
    const play = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        dispatch(playEpisode(episode));
      },
      [dispatch],
    );
    const pause = React.useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        dispatch(setPlayerState('paused'));
      },
      [dispatch],
    );

    return (
      <Button
        {...props}
        ref={ref}
        onClick={isPlaying ? pause : play}
        data-is-current={isCurrentEpisode}
      >
        {isCurrentEpisode ? (isPlaying ? 'Pause' : 'Resume') : 'Play'}
      </Button>
    );
  }),
);
