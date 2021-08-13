import { useCallback } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';

import { usePlayerState } from './usePlayerState';
import styles from './Player.module.css';
import { usePlayerActions } from './usePlayerActions';
import { resumeEpisode, seekBackward, seekForward, setPlayerState } from './context';

export const Player = () => {
  const { queue, currentTrackIndex, state } = usePlayerState();
  const dispatch = usePlayerActions();

  const currentEpisode = queue[currentTrackIndex];
  const open = !!currentEpisode && state !== 'idle';

  const pause = useCallback(() => {
    dispatch(setPlayerState('paused'));
  }, []);
  const resume = useCallback(() => {
    dispatch(resumeEpisode(currentEpisode));
  }, []);
  const seekBack = useCallback(() => {
    dispatch(seekBackward());
  }, []);
  const seekAhead = useCallback(() => {
    dispatch(seekForward());
  }, []);

  return (
    <div className={styles.container} data-open={open}>
      {currentEpisode && (
        <div className={styles.player}>
          <img
            alt={`${currentEpisode.title} by ${currentEpisode.author}`}
            src={currentEpisode.cover}
          />
          <div className={styles.controls}>
            <button onClick={seekBack}>
              <Icon icon="seek-back" />
            </button>
            {state === 'playing' && (
              <button onClick={pause}>
                <Icon icon="pause" />
              </button>
            )}
            {state === 'paused' && (
              <button onClick={resume}>
                <Icon icon="play" />
              </button>
            )}
            <button onClick={seekAhead}>
              <Icon icon="seek-forward" />
            </button>
          </div>
          <div className={styles.info}>
            <p className={styles.title}>{currentEpisode.title}</p>
            <p className={styles.author}>{currentEpisode.author}</p>
          </div>
        </div>
      )}
    </div>
  );
};
