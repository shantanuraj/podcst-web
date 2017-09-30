/**
 * Toolbar component
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

import {
  Link,
} from 'preact-router';

import NavLinks, {
  LinkMap,
} from './NavLinks';
import ConnectedSearch from '../containers/ConnectedSearch';
import Icon from '../svg/Icon';

const toolbar = (theme: App.Theme) => style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  backgroundColor: theme.background,
  position: 'fixed',
  top: 0,
  left: 0,
  height: '64px',
  width: '100%',
  zIndex: 500,
  fontSize: 20,
  color: theme.text,
  boxShadow: `0px 4px 4px 0px rgba(0,0,0,0.75)`,
  $nest: {
    '& nav': {
      padding: 16,
    },
  },
}, media({ maxWidth: 600 }, {
  $nest: {
    '& nav': {
      padding: 0,
    },
  },
}));

const secondaryItems = style({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
});

const link = style({
  paddingLeft: 16,
  paddingRight: 16,
}, media({ maxWidth: 600 }, {
  $nest: { '& span': { display: 'none' } },
}), media({ minWidth: 601 }, {
  $nest: { '& div': { display: 'none' } },
}));

const search = style({
  height: 'inherit',
  paddingLeft: 16,
});

const linkMap: LinkMap = {
  '/': 'Podcasts',
  '/feed/top': 'Top',
};

interface ToolbarProps {
  theme: App.Theme;
}

const Toolbar = ({
  theme,
}: ToolbarProps) => (
  <header class={toolbar(theme)}>
    <NavLinks theme={theme} links={linkMap} />
    <div class={secondaryItems}>
      <Link class={link} href="/settings">
        <Icon icon="settings" color={theme.text} />
        <span>Settings</span>
      </Link>
      <ConnectedSearch theme={theme} className={search} />
    </div>
  </header>
);

export default Toolbar;
