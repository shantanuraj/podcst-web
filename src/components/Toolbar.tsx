/**
 * Toolbar component
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

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

const search = style({
  height: 'inherit',
  marginLeft: 'auto',
});

const linkMap: LinkMap = {
  '/': 'Podcasts',
  '/feed/top': 'Top',
};

const Toolbar = (theme: App.Theme) => (
  <header class={toolbar(theme)}>
    <NavLinks links={linkMap} />
    <ConnectedSearch theme={theme} className={search} />
  </header>
);

export default Toolbar;
