import React from 'react';
import { ThemeMode } from '../../types';

import { Icon, IconType } from '../../ui/icons/svg/Icon';

export default function SettingsThemePage() {
  const [theme, _setTheme] = React.useState<ThemeMode>('light');
  return (
    <form>
      {themes.map((item) => (
        <Theme {...item} currentTheme={theme} />
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
      <input type="radio" id={theme} name="theme" checked={theme === currentTheme} value={theme} />
      <label htmlFor={theme}>
        <Icon icon={icon} />
        {name}
      </label>
    </div>
  );
};
