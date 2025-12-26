import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type KeyboardShortcuts,
  useKeydown,
} from '@/shared/keyboard/useKeydown';
import { getValue, setValue } from '@/shared/storage/local';
import { Icon } from '@/ui/icons/svg/Icon';
import { defaultVolume, getInitialVolume } from './AudioUtils';

import styles from './Player.module.css';
import {
  getIsChromecastConnected,
  getMute,
  getRemotePlayer,
  getSetVolume,
  usePlayer,
} from './usePlayer';

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
  const handleVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const volume = parseInt(e.target.value, 10);
      // Update the volume in the player
      setVolume(volume);
      // Mute the player if the volume is 0
      setMuted(volume === 0);
      // Save the volume in the local storage
      setValue('volume', volume);
    },
    [
      // Update the volume in the player
      setVolume,
    ],
  );

  useEffect(() => {
    mute(muted);
  }, [muted, mute]);

  useEffect(() => {
    // Initialize volume preference on mount
    setVolume(getValue('volume', defaultVolume));
  }, [
    // Initialize volume preference on mount
    setVolume,
  ]);

  const volumeShortcuts: KeyboardShortcuts = useMemo(
    () => (_) => [[shortcuts.mute, toggleMute]],
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
