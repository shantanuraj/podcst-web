import { ChangeEvent, useCallback, useEffect, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import AudioUtils from './AudioUtils';

import styles from './Player.module.css';

export const VolumeControls = () => {
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
      <button onClick={toggleMute}>
        <Icon icon={muted ? 'mute' : 'volume'} />
      </button>
    </div>
  );
};
