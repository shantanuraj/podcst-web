'use client';

import React, { type FormEvent } from 'react';
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
          <h1 className={styles.title}>Theme</h1>
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
  const config: ThemeConfig = `${scheme}/${theme}`;
  const id = `theme-${config}`;

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
          onChange={() => {}} // Controlled by form onChange, but React needs this to avoid warnings
          value={config}
          className="sr-only"
        />
        <div className="flex flex-col">
          <span className="text-lg font-medium group-hover:text-accent transition-colors">
            {scheme.charAt(0).toUpperCase() + scheme.slice(1)}{' '}
            {theme === 'dark' ? 'Dark' : 'Light'}
          </span>
          <span className="text-sm text-ink-secondary">
            {theme === 'dark'
              ? 'Optimized for low-light environments'
              : 'Clean and bright appearance'}
          </span>
        </div>
        <div className="w-6 h-6 border border-rule flex items-center justify-center bg-surface transition-all group-has-[:checked]:border-accent group-hover:border-accent">
          <div className="w-3 h-3 bg-accent opacity-0 group-has-[:checked]:opacity-100 transition-opacity" />
        </div>
      </label>
    </div>
  );
};
