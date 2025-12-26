import { useCallback, useMemo } from 'react';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type KeyboardShortcuts,
  useKeydown,
} from '@/shared/keyboard/useKeydown';
import styles from './Player.module.css';
import { getRate, getSetRate, usePlayer } from './usePlayer';

export const PlaybackRate = () => {
  const setRate = usePlayer(getSetRate);
  const rate = usePlayer(getRate);
  const rateIndex = useMemo(() => rates.indexOf(rate), [rate]);
  const decreaseRate = useCallback(() => {
    setRate(Math.max(0, rateIndex - 1));
  }, [rateIndex, setRate]);
  const bumpRate = useCallback(() => {
    setRate(Math.min(rates.length - 1, rateIndex + 1));
  }, [rateIndex, setRate]);
  const rateShortcuts: KeyboardShortcuts = useMemo(
    () => (_) => [
      [shortcuts.bumpRate, bumpRate],
      [shortcuts.decreaseRate, decreaseRate],
    ],
    [bumpRate, decreaseRate],
  );
  const cycleRate = useCallback(() => {
    const nextRateIndex = (rateIndex + 1) % rates.length;
    const nextRate = rates[nextRateIndex];
    setRate(nextRate);
  }, [setRate, rateIndex]);

  useKeydown(rateShortcuts);

  return (
    <button className={styles.rate} onClick={cycleRate}>
      {rate}x
    </button>
  );
};

const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
