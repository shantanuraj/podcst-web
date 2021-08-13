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

  useKeydown(shortcuts.seekTo, (e) => {
    const seekPercent = parseInt(e.key, 10) / 10;
    if (isNaN(seekPercent)) return;
    const newSeekPosition = Math.floor(seekPercent * durationRef.current);
    AudioUtils.seekTo(newSeekPosition);
  });

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
