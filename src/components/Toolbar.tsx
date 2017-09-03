/**
 * Toolbar component
 */

import {
  h,
} from 'preact';

import {
  Link,
} from 'preact-router';

import {
  style,
} from 'typestyle';

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

const link = style({
  padding: '0 16px',
  textDecoration: 'none',
  color: 'white',
});

const search = style({
  height: 'inherit',
  marginLeft: 'auto',
});

const Toolbar = () => (
  <header class={toolbar}>
    <nav>
      <Link class={link} href="/">
        Podcasts
      </Link>
      <Link class={link} href="/feed/top">
        Top
      </Link>
    </nav>
    <Search class={search} />
  </header>
);

export default Toolbar;
