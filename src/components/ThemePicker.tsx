/**
 * Theme Picker settings component
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

import Icon, {
  IconType,
} from '../svg/Icon';

import {
  onEvent,
} from '../utils';

const container = (theme: App.Theme) => style({
  display: 'flex',
  flexDirection: 'column',
  padding: 32,
  color: theme.text,
  fontSize: 18,
  $nest: {
    '& > span': {
      marginBottom: 16,
    },
    '& > div': {
      display: 'flex',
      alignItems: 'center',
    },
    '& label': {
      display: 'flex',
      alignItems: 'center',
      padding: 16,
    },
    '& label > div': {
      marginRight: 16,
    },
  },
}, media({ maxWidth: 600 }, {
  padding: 16,
}));

interface ThemePickerProps {
  theme: App.Theme;
  onThemeChange(mode: App.ThemeMode);
}

interface ThemeInfo {
  theme: App.ThemeMode;
  icon: IconType;
  name: string;
}

const themes: ThemeInfo[] = [
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

const renderTheme = (
  color: string,
  {
    icon,
    name,
    theme,
  }: ThemeInfo,
) => (
  <div>
    <input type="radio" id={theme} name="theme" value={theme} />
    <label for={theme}>
      <Icon color={color} icon={icon} />
      {name}
    </label>
  </div>
);

const renderThemes = (color: string, themes: ThemeInfo[]) =>
  themes.map(theme => renderTheme(color, theme));

const ThemePicker = ({
  theme,
  onThemeChange,
}: ThemePickerProps) => (
  <form onChange={onEvent(onThemeChange)} class={container(theme)}>
    <span>Change theme</span>
    {renderThemes(theme.text, themes)}
  </form>
);

export default ThemePicker;
