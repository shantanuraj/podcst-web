/**
 * Drawer menu component
 */

import * as React from 'react';

import { style, types } from 'typestyle';

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
  height: 64,
  padding: 16,
  borderBottom: `solid 1px ${theme.backgroundLight}`,
});

const drawer = (theme: App.ITheme) =>
  style({
    display: 'block',
    position: 'fixed',
    height: '100%',
    width: 0,
    zIndex: 502,
    background: theme.background,
    boxShadow: `0px 4px 4px 0px rgba(0,0,0,0.75)`,
    fontSize: 20,
    color: theme.text,
    transform: `translateX(-240px)`,
    transition: 'all 0.3s ease',
    $nest: {
      '&[data-is-drawer-visible="true"]': {
        width: 240,
        minWidth: 240,
        transform: `translateX(0px)`,
      },
      '& nav nav': {
        display: 'flex',
        flexDirection: 'column',
      },
      '& nav nav a': drawerItem(theme),
      '& a:hover, & a:focus': {
        color: theme.background,
        backgroundColor: theme.accent,
        outline: 0,
      },
    },
  });

const drawerHeader = (theme: App.ITheme) =>
  style({
    ...drawerItem(theme),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    cursor: 'pointer',
    $nest: {
      '&:hover, &:hover > span > div > svg': {
        color: theme.background,
        backgroundColor: theme.accent,
        fill: theme.background,
      },
    },
  });

interface IDrawerMenuProps extends IDrawerState {
  theme: App.ITheme;
}

const DrawerMenu = ({ isVisible, theme }: IDrawerMenuProps) => (
  <aside data-is-drawer-visible={isVisible} className={drawer(theme)}>
    <nav>
      <header className={drawerHeader(theme)}>
        <span role="img" aria-label="Close drawer">
          <Icons color={theme.text} icon="back" size={24} />
        </span>
      </header>
      <NavLinks links={linkMap} theme={theme} />
    </nav>
  </aside>
);

export default DrawerMenu;
