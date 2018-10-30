/**
 * Nav links
 */

import * as React from 'react';

import { Link } from 'react-router-dom';

import { style } from 'typestyle';

import { App } from '../typings';

const navLinks = style({
  flex: 1,
});

const navLink = (theme: App.ITheme) =>
  style({
    padding: '0 16px',
    textDecoration: 'none',
    color: theme.text,
  });

export interface ILinkMap {
  [link: string]: string;
}

const renderLink = (theme: App.ITheme, link: string, title: string) => (
  <Link key={title} className={navLink(theme)} to={link}>
    {title}
  </Link>
);

const renderLinks = (theme: App.ITheme, linkMap: ILinkMap) =>
  Object.keys(linkMap).map(link => renderLink(theme, link, linkMap[link]));

interface INavLinksProps {
  links: ILinkMap;
  theme: App.ITheme;
}

const NavLinks = ({ theme, links }: INavLinksProps) => <nav className={navLinks}>{renderLinks(theme, links)}</nav>;

export default NavLinks;
