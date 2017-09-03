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

const navLink = style({
  padding: '0 16px',
  textDecoration: 'none',
  color: 'white',
});

const search = style({
  height: 'inherit',
  marginLeft: 'auto',
});


interface LinkMap {
  [link: string]: string;
}

const linkMap: LinkMap = {
  '/': 'Podcasts',
  '/feed/top': 'Top',
}

const renderLink = (link: string, title: string) => (
  <Link class={navLink} href={link}>
    {title}
  </Link>
);

const renderLinks = (linkMap: LinkMap) =>
  Object
  .keys(linkMap)
  .map(link => renderLink(link, linkMap[link]));

const Toolbar = () => (
  <header class={toolbar}>
    <nav>
      {renderLinks(linkMap)}
    </nav>
    <Search class={search} />
  </header>
);

export default Toolbar;
