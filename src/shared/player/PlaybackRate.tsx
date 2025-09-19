import { useCallback, useMemo } from 'react';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import { KeyboardShortcuts, useKeydown } from '@/shared/keyboard/useKeydown';
import { getRate, getSetRate, usePlayer } from './usePlayer';

import styles from './Player.module.css';

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
    <button className={styles.playbackRate} onClick={cycleRate}>
      <code>{rate}x</code>
    </button>
  );
};

const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
