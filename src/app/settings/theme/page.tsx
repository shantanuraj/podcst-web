'use client';

import React, { type FormEvent } from 'react';
import styles from '@/app/settings/Settings.module.css';
import {
  type IThemeInfo,
  type Scheme,
  type ThemeConfig,
  themes,
  useTheme,
} from '@/shared/theme/useTheme';
import type { ThemeMode } from '@/types';

export default function SettingsThemePage() {
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
    <form className={styles.container} onChange={changeTheme}>
      {themes.map((item) => (
        <Theme key={`${item.scheme}/${item.theme}`} {...item} currentTheme={currentTheme} />
      ))}
    </form>
  );
}

interface ThemeProps extends IThemeInfo {
  currentTheme: ThemeConfig;
}

const Theme = ({ currentTheme, scheme, theme }: ThemeProps) => {
  const config: ThemeConfig = `${scheme}/${theme}`;
  return (
    <div>
      <input
        type="radio"
        id={config}
        name="theme"
        defaultChecked={config === currentTheme}
        value={config}
      />
      <label htmlFor={config}>
        {theme === 'dark' ? 'Dark' : scheme.charAt(0).toUpperCase() + scheme.slice(1)}
      </label>
    </div>
  );
};
