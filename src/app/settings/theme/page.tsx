'use client';

import React, { FormEvent } from 'react';
import { useTheme } from '@/shared/theme/useTheme';
import { ThemeMode } from '@/types';
import { IconType, Icon } from '@/ui/icons/svg/Icon';

import styles from '@/app/settings/Settings.module.css';

export default function SettingsThemePage() {
  const { theme, changeTheme: setTheme } = useTheme();
  const changeTheme = React.useCallback(
    (e: FormEvent) => {
      setTheme((e.target as HTMLInputElement).value as ThemeMode);
    },
    [setTheme],
  );
  return (
    <form className={styles.container} onChange={changeTheme}>
      {themes.map((item) => (
        <Theme key={item.theme} {...item} currentTheme={theme as ThemeMode} />
      ))}
    </form>
  );
}

interface IThemeInfo {
  theme: ThemeMode;
  icon: IconType;
  name: string;
}

const themes: IThemeInfo[] = [
  {
    theme: 'light',
    icon: 'day',
    name: 'Light',
  },
  {
    theme: 'dark',
    icon: 'night',
    name: 'Dark',
  },
];

interface ThemeProps extends IThemeInfo {
  currentTheme: ThemeMode;
}

const Theme = ({ currentTheme, name, icon, theme }: ThemeProps) => {
  return (
    <div>
      <input
        type="radio"
        id={theme}
        name="theme"
        defaultChecked={theme === currentTheme}
        value={theme}
      />
      <label htmlFor={theme}>
        <Icon icon={icon} />
        {name}
      </label>
    </div>
  );
};
