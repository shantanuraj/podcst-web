import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type KeyboardShortcuts,
  useKeydown,
} from '@/shared/keyboard/useKeydown';
import { getValue, setValue } from '@/shared/storage/local';
import { Icon } from '@/ui/icons/svg/Icon';
import { defaultVolume, getInitialVolume } from './AudioUtils';
import {
  getIsChromecastConnected,
  getMute,
  getRemotePlayer,
  getSetVolume,
  usePlayer,
} from './usePlayer';
import styles from './VolumeControls.module.css';

export const VolumeControls = () => {
  const { t } = useTranslation();
  const [volume, setVolumeValue] = useState(getInitialVolume);
  const isChromecastConnected = usePlayer(getIsChromecastConnected);
  const remotePlayer = usePlayer(getRemotePlayer);
  const canControlVolume =
    !isChromecastConnected || !remotePlayer || remotePlayer.canControlVolume;

  const [muted, setMuted] = useState(false);
  const mute = usePlayer(getMute);
  const setVolume = usePlayer(getSetVolume);
  const toggleMute = useCallback(() => setMuted((muted) => !muted), []);
  const handleVolumeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const volume = parseInt(e.target.value, 10);
      setVolume(volume);
      setVolumeValue(volume);
      setMuted(volume === 0);
      setValue('volume', volume);
    },
    [setVolume],
  );

  useEffect(() => {
    mute(muted);
  }, [muted, mute]);

  useEffect(() => {
    setVolume(getValue('volume', defaultVolume));
  }, [setVolume]);

  const volumeShortcuts: KeyboardShortcuts = useMemo(
    () => (_) => [[shortcuts.mute, toggleMute]],
    [toggleMute],
  );
  useKeydown(volumeShortcuts);

  return (
    <div className={styles.volume}>
      <button
        type="button"
        onClick={toggleMute}
        disabled={!canControlVolume}
        aria-label={muted ? t('player.unmute') : t('player.mute')}
        aria-pressed={muted}
      >
        <Icon icon={muted ? 'mute' : 'volume'} size={20} />
      </button>
      {canControlVolume && (
        <input
          onChange={handleVolumeChange}
          type="range"
          name="volume"
          min="0"
          max="100"
          value={muted ? 0 : volume}
          aria-label={t('player.volume')}
          style={
            { '--volume': `${muted ? 0 : volume}%` } as React.CSSProperties
          }
        />
      )}
    </div>
  );
};
