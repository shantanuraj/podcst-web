import { MouseEvent, useCallback, useEffect, useRef } from 'react';

import { IEpisodeInfo, PlayerState } from '../../types';
import { useKeydown } from '../keyboard/useKeydown';
import { shortcuts } from '../keyboard/shortcuts';

import AudioUtils from './AudioUtils';
import styles from './Player.module.css';

export const Seekbar: React.FC<{
  currentEpisode: IEpisodeInfo | null;
  state: PlayerState;
}> = ({ currentEpisode, state }) => {
  const seekbarRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef(currentEpisode?.duration || 0);
  const seekPositionRef = useRef(0);
  const open = state !== 'idle';

  const syncSeekbarWidth = useCallback(() => {
    if (!seekbarRef.current) return;
    seekbarRef.current.style.width = getSeekWidth(seekPositionRef.current, durationRef.current);
  }, []);

  const seekByFraction = useCallback((seekFraction: number) => {
    const newSeekPosition = Math.floor(seekFraction * durationRef.current);
    AudioUtils.seekTo(newSeekPosition);
    syncSeekbarWidth();
  }, []);

  const seekOnKeydown = useCallback((e: KeyboardEvent) => {
    const seekPercent = parseInt(e.key, 10) / 10;
    if (isNaN(seekPercent)) return;
    seekByFraction(seekPercent);
  }, []);
  useKeydown(shortcuts.seekTo, seekOnKeydown);

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

  useEffect(() => {
    if (state === 'playing' || state === 'paused') {
      syncSeekbarWidth();
    } else if (state === 'buffering' && seekbarRef.current) {
      seekbarRef.current.style.width = '100%';
    }
  }, [state, syncSeekbarWidth]);

  const seekHandler = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const seekFraction = e.nativeEvent.offsetX / e.currentTarget.offsetWidth;
    seekByFraction(seekFraction);
  }, []);

  return (
    <button className={styles.seekbarContainer} onClick={seekHandler}>
      <div
        className={styles.seekbar}
        data-is-buffering={state === 'buffering'}
        ref={seekbarRef}
        onTransitionEnd={syncSeekbarWidth}
      />
    </button>
  );
};

function getSeekWidth(seekPosition: number, duration: number): string {
  return `${(seekPosition / duration) * 100}%`;
}
