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
import Search from './Search';

const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  backgroundColor: '#292929',
  position: 'fixed',
  top: 0,
  left: 0,
  height: '64px',
  width: '100%',
  zIndex: 500,
  paddingLeft: 16,
  fontSize: 20,
  color: 'white',
  boxShadow: `0 2px 2px -2px rgba(0,0,0,.15)`,
});

const search = style({
  height: 'inherit',
  marginLeft: 'auto',
});

const linkMap: LinkMap = {
  '/': 'Podcasts',
  '/feed/top': 'Top',
};

const Toolbar = () => (
  <header class={toolbar}>
    <NavLinks links={linkMap} />
    <Search class={search} />
  </header>
);

export default Toolbar;
