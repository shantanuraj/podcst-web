import { MouseEvent, useCallback, useEffect, useRef } from 'react';

import { IEpisodeInfo } from '../../types';
import { useKeydown } from '../keyboard/useKeydown';
import { shortcuts } from '../keyboard/shortcuts';

import { getPlaybackState, getSeekTo, usePlayer } from './usePlayer';
import styles from './Player.module.css';

export const Seekbar: React.FC<{
  currentEpisode: IEpisodeInfo | null;
}> = ({ currentEpisode }) => {
  const state = usePlayer(getPlaybackState);
  const seekTo = usePlayer(getSeekTo);
  const seekbarRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef(currentEpisode?.duration || 0);

  const seekByFraction = useCallback((seekFraction: number) => {
    const newSeekPosition = Math.floor(seekFraction * durationRef.current);
    seekTo(newSeekPosition);
  }, []);

  const seekOnKeydown = useCallback((e: KeyboardEvent) => {
    const seekPercent = parseInt(e.key, 10) / 10;
    if (isNaN(seekPercent)) return;
    seekByFraction(seekPercent);
  }, []);
  useKeydown(shortcuts.seekTo, seekOnKeydown);

  useEffect(
    () =>
      usePlayer.subscribe(
        (duration) => {
          durationRef.current = duration as number;
        },
        (playerState) => playerState.duration,
      ),
    [],
  );

  useEffect(
    () =>
      usePlayer.subscribe(
        (seekPosition) => {
          requestAnimationFrame(() => {
            if (!seekbarRef.current) return;
            seekbarRef.current.style.width = getSeekWidth(
              seekPosition as number,
              durationRef.current,
            );
          });
        },
        (playerState) => playerState.seekPosition,
      ),
    [],
  );

  useEffect(() => {
    if (state === 'buffering' && seekbarRef.current) {
      seekbarRef.current.style.width = '100%';
    }
  }, [state]);

  const seekHandler = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const seekFraction = e.nativeEvent.offsetX / e.currentTarget.offsetWidth;
    seekByFraction(seekFraction);
  }, []);

  return (
    <button className={styles.seekbarContainer} onClick={seekHandler}>
      <div className={styles.seekbar} data-is-buffering={state === 'buffering'} ref={seekbarRef} />
    </button>
  );
};

function getSeekWidth(seekPosition: number, duration: number): string {
  return `${(seekPosition / duration) * 100}%`;
}
