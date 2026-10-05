'use client';

import { useMemo } from 'react';
import { useTranslation } from '@/shared/i18n';
import { shortcuts } from '@/shared/keyboard/shortcuts';
import {
  type KeyboardShortcuts,
  useKeydown,
} from '@/shared/keyboard/useKeydown';
import { useHydrated } from '@/shared/useHydrated';
import { Menu } from '@/ui/Menu/Menu';
import { speeds } from '../../../contracts/playback/rules.json';
import styles from './Speed.module.css';
import { getRate, getSetRate, usePlayer } from './usePlayer';

const label = (speed: number) => `${speed}×`;

export function useSpeedShortcuts() {
  const step = useMemo<KeyboardShortcuts>(() => {
    const by = (offset: number) => () => {
      const { rate, setRate } = usePlayer.getState();
      const index = speeds.supported.indexOf(rate);
      const next =
        speeds.supported[
          Math.min(Math.max(index + offset, 0), speeds.supported.length - 1)
        ];
      if (next !== undefined) setRate(next);
    };
    return () => [
      [shortcuts.bumpRate, by(1)],
      [shortcuts.decreaseRate, by(-1)],
    ];
  }, []);
  useKeydown(step);
}

export function SpeedMenu() {
  const { t } = useTranslation();
  const rate = usePlayer(getRate);
  const setRate = usePlayer(getSetRate);
  return (
    <Menu
      label={t('player.speed')}
      triggerClassName={styles.chip}
      trigger={label(rate)}
    >
      {(close) => (
        <fieldset aria-label={t('player.speed')} className={styles.group}>
          {speeds.supported.map((speed) => (
            <button
              key={speed}
              type="button"
              aria-pressed={speed === rate}
              onClick={() => {
                setRate(speed);
                close();
              }}
            >
              {label(speed)}
            </button>
          ))}
        </fieldset>
      )}
    </Menu>
  );
}

export function SpeedPresets() {
  const { t } = useTranslation();
  const rate = usePlayer(getRate);
  const hydrated = useHydrated();
  const setRate = usePlayer(getSetRate);
  return (
    <fieldset aria-label={t('player.speed')} className={styles.presets}>
      {speeds.supported.map((speed) => (
        <button
          key={speed}
          type="button"
          aria-pressed={hydrated && speed === rate}
          onClick={() => setRate(speed)}
        >
          {label(speed)}
        </button>
      ))}
    </fieldset>
  );
}
