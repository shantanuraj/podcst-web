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

import { IAppState } from '../stores/app';

import ImportPodcastsView from './ImportPodcastsView';
import NavLinks, {
  ILinkMap,
} from './NavLinks';
import Shortcuts from './Shortcuts';
import ThemePicker from './ThemePicker';

const linkMap = (version: string): ILinkMap => ({
  '/settings?section=theme': 'Change Theme',
  '/settings?section=shortcuts': 'Shortcuts',
  '/settings?section=import': 'Import Podcasts',
  '#about': `Version: ${version}`,
});

const componentsMap = ({
  mode,
  theme,
  changeTheme,
}: ISettingsProps) => ({
  theme: <ThemePicker mode={mode} onThemeChange={changeTheme} theme={theme} />,
  shortcuts: <Shortcuts theme={theme} />,
  import: <ImportPodcastsView theme={theme} />,
});

interface ISettingsProps extends IAppState {
  section: 'theme' | 'shortcuts';
  version: string;
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

const Settings = (props: ISettingsProps) => {
  const {
    theme,
    section,
    version,
  } = props;

  if (section) {
    return componentsMap(props)[section];
  }

  return (
    <div class={container(theme)}>
      <NavLinks links={linkMap(version)} theme={theme} />
    </div>
  );
};

export default Settings;