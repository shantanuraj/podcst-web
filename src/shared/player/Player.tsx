import { ChangeEvent, useCallback, useEffect, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';

import { usePlayerState } from './usePlayerState';
import styles from './Player.module.css';
import { usePlayerActions } from './usePlayerActions';
import { resumeEpisode, seekBackward, seekForward, setPlayerState } from './context';
import { VolumeIcon } from '../../ui/icons/svg/VolumeIcon';
import { MuteIcon } from '../../ui/icons/svg/MuteIcon';
import AudioUtils from './AudioUtils';

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
          <div className={styles.spacer} />
          <VolumeControls />
        </div>
      )}
    </div>
  );
};

const VolumeControls = () => {
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => {
    setMuted((muted) => !muted);
  }, []);
  const handleVolumeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const volume = parseInt(e.target.value, 10);
    AudioUtils.setVolume(volume);
    setMuted(volume === 0);
  }, []);

  useEffect(() => {
    AudioUtils.mute(muted);
  }, [muted]);

  return (
    <div className={styles.volumeControl}>
      <input
        onChange={handleVolumeChange}
        type="range"
        name="volume"
        min="0"
        max="100"
        defaultValue="100"
      />
      <button onClick={toggleMute}>{muted ? <MuteIcon /> : <VolumeIcon />}</button>
    </div>
  );
};
