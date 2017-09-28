/**
 * Settings component
 */

import {
  h,
} from 'preact';

import {
  style,
  types,
} from 'typestyle';

import NavLinks, {
  LinkMap,
} from './NavLinks';

const linkMap: LinkMap = {
  '/settings?section=theme': 'Change Theme',
  '/settings?section=shortcuts': 'Shortcuts',
}

const componentsMap = {
  'theme': <div>theme</div>,
  'shortcuts': <div>shortcuts</div>,
}

interface SettingsProps {
  theme: App.Theme;
  section: 'theme' | 'shortcuts';
}

const fillVertically: types.NestedCSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
}

const container = style({
  ...fillVertically,
  $nest: {
    '& nav': fillVertically,
    '& nav a': { margin: 8 },
  },
});

const Settings = ({
  theme,
  section,
}: SettingsProps) => {
  if (section) {
    return componentsMap[section];
  } else {
    return (
      <div class={container}>
        <NavLinks links={linkMap} theme={theme} />
      </div>
    );
  }
}

export default Settings;
