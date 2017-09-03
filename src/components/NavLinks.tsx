/**
 * Nav links
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

const navLink = style({
  padding: '0 16px',
  textDecoration: 'none',
  color: 'white',
});

export interface LinkMap {
  [link: string]: string;
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

interface NavLinksProps {
  links: LinkMap,
}

const NavLinks = ({ links }: NavLinksProps) => (
  <nav>
    {renderLinks(links)}
  </nav>
);

export default NavLinks;
