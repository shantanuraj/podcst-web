'use client';

import React, { type FormEvent } from 'react';
import { useTranslation } from '@/shared/i18n';
import {
  type IThemeInfo,
  type Scheme,
  type ThemeConfig,
  themes,
  useTheme,
} from '@/shared/theme/useTheme';
import type { ThemeMode } from '@/types';
import styles from '../Settings.module.css';

export default function SettingsThemePage() {
  const { t } = useTranslation();
  const { scheme, theme, changeTheme: setTheme } = useTheme();
  const changeTheme = React.useCallback(
    (e: FormEvent) => {
      const config = (e.target as HTMLInputElement).value as ThemeConfig;
      const [scheme, theme] = config.split('/') as [Scheme, ThemeMode];
      setTheme(scheme, theme);
    },
    [setTheme],
  );
  const currentTheme = `${scheme}/${theme}` as const;

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>{t('settings.theme')}</h1>
        </header>
        <form onChange={changeTheme}>
          {themes.map((item) => (
            <Theme
              key={`${item.scheme}/${item.theme}`}
              {...item}
              currentTheme={currentTheme}
            />
          ))}
        </form>
      </div>
    </div>
  );
}

interface ThemeProps extends IThemeInfo {
  currentTheme: ThemeConfig;
}

const Theme = ({ currentTheme, scheme, theme }: ThemeProps) => {
  const { t } = useTranslation();
  const config: ThemeConfig = `${scheme}/${theme}`;
  const id = `theme-${config}`;

  const themeKey =
    `${scheme}${theme.charAt(0).toUpperCase() + theme.slice(1)}` as
      | 'autumnLight'
      | 'autumnDark';
  const themeLabel = t(`themes.${themeKey}` as const);
  const themeBlurb =
    theme === 'dark' ? t('themes.darkBlurb') : t('themes.lightBlurb');

  return (
    <div className={styles.shortcutRow}>
      <label
        htmlFor={id}
        className="flex items-center justify-between flex-1 cursor-pointer group has-[:checked]:bg-accent-subtle hover:bg-accent-subtle transition-colors px-4 -mx-4 py-4"
      >
        <input
          type="radio"
          id={id}
          name="theme"
          checked={config === currentTheme}
          onChange={() => {}}
          value={config}
          className="sr-only"
        />
        <div className="flex flex-col">
          <span className="text-lg font-medium group-hover:text-accent transition-colors">
            {themeLabel}
          </span>
          <span className="text-sm text-ink-secondary">{themeBlurb}</span>
        </div>
        <div className="w-6 h-6 border border-rule flex items-center justify-center bg-surface transition-all group-has-[:checked]:border-accent group-hover:border-accent">
          <div className="w-3 h-3 bg-accent opacity-0 group-has-[:checked]:opacity-100 transition-opacity" />
        </div>
      </label>
    </div>
  );
};
