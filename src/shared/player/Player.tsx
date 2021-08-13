import { useCallback } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';

import { resumeEpisode, seekBackward, seekForward, setPlayerState } from './context';
import { Seekbar } from './Seekbar';
import { usePlayerActions } from './usePlayerActions';
import { usePlayerState } from './usePlayerState';
import { VolumeControls } from './VolumeControls';

import styles from './Player.module.css';

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
          <Seekbar currentEpisode={currentEpisode} state={state} />
          <img
            alt={`${currentEpisode.title} by ${currentEpisode.author}`}
            src={currentEpisode.cover}
          />
          <div className={styles.controls}>
            <button onClick={seekBack}>
              <Icon icon="seek-back" />
            </button>
            {state === 'playing' ||
              (state === 'buffering' && (
                <button onClick={pause}>
                  <Icon icon="pause" />
                </button>
              ))}
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
          <div className={styles.spacer} />
          <VolumeControls />
        </div>
      )}
    </div>
  );
};
