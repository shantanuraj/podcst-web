import { useCallback } from 'react';
import Link from 'next/link';

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

  const togglePlayback = useCallback(() => {
    dispatch(state === 'paused' ? resumeEpisode(currentEpisode) : setPlayerState('paused'));
  }, [state, currentEpisode]);
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
          <Link
            href={{
              pathname: '/episode',
              query: { feed: currentEpisode.feed, title: currentEpisode.title },
            }}
          >
            <a>
              <img
                alt={`${currentEpisode.title} by ${currentEpisode.author}`}
                src={currentEpisode.cover}
              />
            </a>
          </Link>
          <div className={styles.controls}>
            <button onClick={seekBack}>
              <Icon icon="seek-back" />
            </button>
            <button onClick={togglePlayback}>
              <Icon icon={state === 'playing' ? 'pause' : 'play'} />
            </button>
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
