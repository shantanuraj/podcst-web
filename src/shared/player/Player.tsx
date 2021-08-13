import { ChangeEvent, MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';

import { usePlayerState } from './usePlayerState';
import styles from './Player.module.css';
import { usePlayerActions } from './usePlayerActions';
import { resumeEpisode, seekBackward, seekForward, setPlayerState } from './context';
import { VolumeIcon } from '../../ui/icons/svg/VolumeIcon';
import { MuteIcon } from '../../ui/icons/svg/MuteIcon';
import AudioUtils from './AudioUtils';
import { IEpisodeInfo, PlayerState } from '../../types';

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

const Seekbar: React.FC<{
  currentEpisode: IEpisodeInfo | null;
  state: PlayerState;
}> = ({ currentEpisode, state }) => {
  const seekbarRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef(currentEpisode?.duration || 0);
  const seekPositionRef = useRef(0);
  const open = state !== 'idle';

  useEffect(() => {
    if (open) {
      AudioUtils.subscribeDuration((duration) => (durationRef.current = duration));
      AudioUtils.subscribeSeekUpdate((seekPosition) => (seekPositionRef.current = seekPosition));
    }
    return () => {
      AudioUtils.subscribeDuration();
      AudioUtils.subscribeSeekUpdate();
    };
  }, [open]);

  const syncSeekbarWidth = useCallback(() => {
    if (!seekbarRef.current) return;
    seekbarRef.current.style.width = getSeekWidth(seekPositionRef.current, durationRef.current);
  }, []);

  useEffect(() => {
    if (state === 'playing') {
      syncSeekbarWidth();
    }
  }, [state, syncSeekbarWidth]);

  const seekHandler = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const seekFraction = e.nativeEvent.offsetX / e.currentTarget.offsetWidth;
    const newSeekPosition = Math.floor(seekFraction * durationRef.current);
    AudioUtils.seekTo(newSeekPosition);
  }, []);

  return (
    <div className={styles.seekbarContainer} onClick={seekHandler}>
      <div
        className={styles.seekbar}
        data-is-buffering={state === 'buffering'}
        ref={seekbarRef}
        onTransitionEnd={syncSeekbarWidth}
      />
    </div>
  );
};

function getSeekWidth(seekPosition: number, duration: number): string {
  return `${(seekPosition / duration) * 100}%`;
}
