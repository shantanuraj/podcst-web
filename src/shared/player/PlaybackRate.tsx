import { useCallback, useEffect, useState } from 'react';
import AudioUtils from './AudioUtils';

import styles from './Player.module.css';

export const PlaybackRate = () => {
  const [rateIndex, setRateIndex] = useState(0);
  const cycleRate = useCallback(() => {
    setRateIndex((rateIndex) => (rateIndex + 1) % rates.length);
  }, []);
  const rate = rates[rateIndex];

  useEffect(() => {
    AudioUtils.changeRate(rate);
  }, [rate]);

  return (
    <button className={styles.playbackRate} onClick={cycleRate}>
      <code>{rate}x</code>
    </button>
  );
};

const rates = [1, 1.25, 1.5, 2, 0.5, 0.75];
