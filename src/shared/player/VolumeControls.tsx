import { ChangeEvent, useCallback, useEffect, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';

import styles from './Player.module.css';
import { getMute, getSetVolume, usePlayer } from './usePlayer';

export const VolumeControls = () => {
  const [muted, setMuted] = useState(false);
  const mute = usePlayer(getMute);
  const setVolume = usePlayer(getSetVolume);
  const toggleMute = useCallback(() => {
    setMuted((muted) => !muted);
  }, []);
  const handleVolumeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const volume = parseInt(e.target.value, 10);
    setVolume(volume);
    setMuted(volume === 0);
  }, []);

  useEffect(() => {
    mute(muted);
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
