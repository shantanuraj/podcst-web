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

const navLinks = style({
  flex: 1,
});

const navLink = (theme: App.Theme) => style({
  padding: '0 16px',
  textDecoration: 'none',
  color: theme.text,
});

export interface LinkMap {
  [link: string]: string;
}

const renderLink = (theme: App.Theme, link: string, title: string) => (
  <Link class={navLink(theme)} href={link}>
    {title}
  </Link>
);

const renderLinks = (theme: App.Theme, linkMap: LinkMap) =>
  Object
  .keys(linkMap)
  .map(link => renderLink(theme, link, linkMap[link]));

interface NavLinksProps {
  links: LinkMap,
  theme: App.Theme,
}

const NavLinks = ({
  theme,
  links,
}: NavLinksProps) => (
  <nav class={navLinks}>
    {renderLinks(theme, links)}
  </nav>
);

export default NavLinks;
