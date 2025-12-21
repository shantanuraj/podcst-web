import { useEffect, useRef } from 'react';

import { formatSecondsToTimestamp } from './formatTime';
import styles from './Player.module.css';
import { usePlayer } from './usePlayer';

export const Duration = () => {
  const seekPositionRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      usePlayer.subscribe(
        (playerState) => playerState.seekPosition,
        (seekPosition) => {
          const seekPositionEl = seekPositionRef.current;
          if (!seekPositionEl) return;
          seekPositionEl.innerText = formatSecondsToTimestamp(seekPosition);
        },
      ),
    [],
  );

  useEffect(
    () =>
      usePlayer.subscribe(
        (playerState) => playerState.duration,
        (duration) => {
          const durationEl = durationRef.current;
          if (!durationEl) return;
          durationEl.innerText = formatSecondsToTimestamp(duration);
        },
      ),
    [],
  );

  return (
    <div className={styles.duration}>
      <span ref={seekPositionRef}>0:00</span>
      <span>/</span>
      <span ref={durationRef}>0:00</span>
    </div>
  );
};
