/**
 * Drawer menu component
 */

import * as React from 'react';

import { media, style, types } from 'typestyle';

import { IDrawerState } from '../stores/drawer';

import NavLinks, { ILinkMap } from './NavLinks';

import Icons from '../svg/Icon';

import { App } from '../typings';

const linkMap: ILinkMap = {
  '/subs': 'Subscriptions',
  '/recents': 'Recents',
  '/feed/top': 'Top',
  '/settings': 'Settings',
};

const drawerItem = (theme: App.ITheme): types.NestedCSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  padding: '2rem',
  ...media(
    { minWidth: 600 },
    {
      padding: '1rem',
      height: 64,
    },
  ),
});

const drawer = (theme: App.ITheme) =>
  style(
    {
      background: theme.background,
      fontSize: 20,
      color: theme.text,
      position: 'fixed',
      bottom: '0',
      width: '100%',
      $nest: {
        '& li a': drawerItem(theme),
        '& a:hover, & a:focus': {
          color: theme.background,
          backgroundColor: theme.accent,
          outline: 0,
        },
      },
    },
    media(
      { minWidth: 600 },
      {
        position: 'relative',
        width: '20rem',
        padding: '64px 0 0',
      },
    ),
  );

interface IDrawerMenuProps extends IDrawerState {
  theme: App.ITheme;
}

const DrawerMenu = ({ isVisible, theme }: IDrawerMenuProps) => (
  <nav className={drawer(theme)}>
    <NavLinks links={linkMap} theme={theme} />
  </nav>
);

export default DrawerMenu;
