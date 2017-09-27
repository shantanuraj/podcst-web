/**
 * Toolbar component
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  Link,
} from 'preact-router';

import NavLinks, {
  LinkMap,
} from './NavLinks';
import ConnectedSearch from '../containers/ConnectedSearch';

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
  paddingLeft: 16,
  fontSize: 20,
  color: theme.text,
  boxShadow: `0px 4px 4px 0px rgba(0,0,0,0.75)`,
});

const secondaryItems = style({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
});

const search = style({
  height: 'inherit',
  marginLeft: 32,
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
      <Link href="/settings">
        Settings
      </Link>
      <ConnectedSearch theme={theme} className={search} />
    </div>
  </header>
);

export default Toolbar;
