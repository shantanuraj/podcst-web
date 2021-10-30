import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import { shortcuts } from '../keyboard/shortcuts';
import { KeyboardShortcuts, useKeydown } from '../keyboard/useKeydown';
import { getValue, setValue } from '../storage/local';

import styles from './Player.module.css';
import {
  getIsChromecastConnected,
  getMute,
  getRemotePlayer,
  getSetVolume,
  usePlayer,
} from './usePlayer';

const defaultVolume = 50;
const getInitialVolume = () => getValue('volume', defaultVolume);

export const VolumeControls = () => {
  const [initialVolume] = useState(getInitialVolume);
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
    // Update the volume in the player
    setVolume(volume);
    // Mute the player if the volume is 0
    setMuted(volume === 0);
    // Save the volume in the local storage
    setValue('volume', volume);
  }, []);

  useEffect(() => {
    mute(muted);
  }, [muted]);

  useEffect(() => {
    // Initialize volume preference on mount
    setVolume(getValue('volume', defaultVolume));
  }, []);

  const volumeShortcuts: KeyboardShortcuts = useMemo(
    () => [
      [shortcuts.mute, toggleMute],
    ],
    [toggleMute],
  );
  useKeydown(volumeShortcuts);

  return (
    <div className={styles.volumeControl}>
      {canControlVolume && (
        <input
          onChange={handleVolumeChange}
          type="range"
          name="volume"
          min="0"
          max="100"
          defaultValue={initialVolume}
        />
      )}
      <button onClick={toggleMute} disabled={!canControlVolume}>
        <Icon icon={muted ? 'mute' : 'volume'} size={24} />
      </button>
    </div>
  );
};
