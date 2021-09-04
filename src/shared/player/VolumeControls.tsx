import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';

import styles from './Player.module.css';
import {
  getIsChromecastConnected,
  getMute,
  getRemotePlayer,
  getSetVolume,
  usePlayer,
} from './usePlayer';

export const VolumeControls = () => {
  const isChromecastConnected = usePlayer(getIsChromecastConnected);
  const remotePlayer = usePlayer(getRemotePlayer);
  const canControlVolume = useMemo(() => {
    if (!isChromecastConnected || !remotePlayer) return true;
    return remotePlayer.canControlVolume;
  }, [isChromecastConnected, remotePlayer]);

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
      {canControlVolume && (
        <input
          onChange={handleVolumeChange}
          type="range"
          name="volume"
          min="0"
          max="100"
          defaultValue="100"
        />
      )}
      <button onClick={toggleMute} disabled={!canControlVolume}>
        <Icon icon={muted ? 'mute' : 'volume'} />
      </button>
    </div>
  );
};
