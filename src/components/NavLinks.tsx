/**
 * Nav links
 */

import * as React from 'react';

import { Link } from 'react-router-dom';

import { media, style } from 'typestyle';

import { App } from '../typings';

const navLinks = style(
  {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'row',
    margin: 0,
    padding: 0,
    justifyContent: 'space-between',
  },
  media(
    { minWidth: 600 },
    {
      flexDirection: 'column',
    },
  ),
);

const navLink = (theme: App.ITheme) =>
  style(
    {
      textDecoration: 'none',
      color: theme.text,
      flex: 1,
    },
    media({ minWidth: 600 }, {}),
  );

export interface ILinkMap {
  [link: string]: string;
}

const renderLink = (theme: App.ITheme, link: string, title: string) => (
  <li>
    <Link key={title} className={navLink(theme)} to={link}>
      {title}
    </Link>
  </li>
);

const renderLinks = (theme: App.ITheme, linkMap: ILinkMap) =>
  Object.keys(linkMap).map(link => renderLink(theme, link, linkMap[link]));

interface INavLinksProps {
  links: ILinkMap;
  theme: App.ITheme;
}

const NavLinks = ({ theme, links }: INavLinksProps) => <ul className={navLinks}>{renderLinks(theme, links)}</ul>;

export default NavLinks;
