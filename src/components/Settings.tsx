/**
 * Settings component
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
  types,
} from 'typestyle';

import NavLinks, {
  LinkMap,
} from './NavLinks';
import ThemePicker from './ThemePicker';
import Shortcuts from './Shortcuts';

const linkMap: LinkMap = {
  '/settings?section=theme': 'Change Theme',
  '/settings?section=shortcuts': 'Shortcuts',
};

const componentsMap = ({
  theme,
  changeTheme,
}: SettingsProps) => ({
  'theme': <ThemePicker onThemeChange={changeTheme} theme={theme} />,
  'shortcuts': <Shortcuts />,
});

interface SettingsProps {
  theme: App.Theme;
  section: 'theme' | 'shortcuts';
  changeTheme(mode: App.ThemeMode);
}

const fillVertically: types.NestedCSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
};

const container = (theme: App.Theme) => style({
  ...fillVertically,
  $nest: {
    '& nav': {
      ...fillVertically,
      width: '100%',
      justifyContent: 'flex-start',
    },
    '& nav a': {
      padding: 32,
      width: '100%',
      '&:nth-child(even)': {
        backgroundColor: theme.backgroundLight,
      },
    },
  },
}, media({ maxWidth: 600 }, {
  $nest: {
    '& nav a': {
      paddingLeft: 16,
      paddingRight: 16,
    },
  },
}));

const Settings = (props: SettingsProps) => {
  const {
    theme,
    section,
  } = props;

  if (section) {
    return componentsMap(props)[section];
  }

  return (
    <div class={container(theme)}>
      <NavLinks links={linkMap} theme={theme} />
    </div>
  );
}

export default Settings;
