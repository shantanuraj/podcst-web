import { forwardRef, useCallback, memo } from 'react';
import {
  getCurrentEpisode,
  getPlaybackState,
  IPlayerState,
  usePlayer,
} from '../../shared/player/usePlayer';

import styles from './Button.module.css';
import { IEpisodeInfo } from '../../types';
import { Button, ButtonProps } from './Button';
import { Icon } from '../icons/svg/Icon';

interface PlayButtonProps extends ButtonProps {
  episode: IEpisodeInfo;
};

export const PlayButtonIcon = memo(
  forwardRef<HTMLButtonElement, PlayButtonProps>(function PlayButton({ episode, ...props }, ref) {
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
      <Button className={styles.withIcon} {...props} ref={ref} onClick={handleClick} data-is-current={isCurrentEpisode}>
        {isCurrentEpisode ? (isPlaying ? <Icon icon="pause" size={24}/> : <Icon icon="play" size={24}/>) : <Icon icon="play" size={35}/>}
      </Button>
    );
  }),
);

const selectIsCurrentEpisode = (episode: IEpisodeInfo) => (playerState: IPlayerState) =>
  getCurrentEpisode(playerState)?.guid === episode.guid && playerState.state !== 'idle';
const selectPlay = (playerState: IPlayerState) => playerState.playEpisode;
const selectResume = (playerState: IPlayerState) => playerState.resumeEpisode;
const selectSetPlayerState = (playerState: IPlayerState) => playerState.setPlayerState;
