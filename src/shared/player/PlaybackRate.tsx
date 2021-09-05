import { useCallback, useEffect, useMemo, useState } from 'react';
import { shortcuts } from '../keyboard/shortcuts';
import { KeyboardShortcuts, useKeydown } from '../keyboard/useKeydown';
import { getSetRate, usePlayer } from './usePlayer';

import styles from './Player.module.css';

export const PlaybackRate = () => {
  const [rateIndex, setRateIndex] = useState(defaultRate);
  const setRate = usePlayer(getSetRate);
  const decreaseRate = useCallback(() => {
    setRateIndex((rateIndex) => Math.max(0, rateIndex - 1));
  }, []);
  const bumpRate = useCallback(() => {
    setRateIndex((rateIndex) => Math.min(rates.length - 1, rateIndex + 1));
  }, []);
  const rateShortcuts: KeyboardShortcuts = useMemo(
    () => [
      [shortcuts.bumpRate, bumpRate],
      [shortcuts.decreaseRate, decreaseRate],
    ],
    [],
  );
  const cycleRate = useCallback(() => {
    setRateIndex((rateIndex) => (rateIndex + 1) % rates.length);
  }, []);
  const rate = rates[rateIndex];

  useKeydown(rateShortcuts);
  useEffect(() => {
    setRate(rate);
  }, [rate]);

  return (
    <button className={styles.playbackRate} onClick={cycleRate}>
      <code>{rate}x</code>
    </button>
  );
};

const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
const defaultRate = rates.indexOf(1);
