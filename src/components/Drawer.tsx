/**
 * Drawer menu component
 */

import { h } from 'preact';

import { style, types } from 'typestyle';

import { IDrawerState } from '../stores/drawer';

import NavLinks, { ILinkMap } from './NavLinks';

import Icons from '../svg/Icon';

const linkMap: ILinkMap = {
  '/subs': 'Subscriptions',
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
      '&[data-is-drawer-visible]': {
        width: 240,
        minWidth: 240,
        transform: `translateX(0px)`,
      },
      '& nav nav': {
        display: 'flex',
        flexDirection: 'column',
      },
      '& nav nav a': drawerItem(theme),
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
      '& span': {
        marginLeft: 16,
      },
    },
  });

interface IDrawerMenuProps extends IDrawerState {
  theme: App.ITheme;
  toggleDrawer: () => void;
}

const DrawerMenu = ({ isVisible, theme, toggleDrawer }: IDrawerMenuProps) => (
  <aside data-is-drawer-visible={isVisible} class={drawer(theme)}>
    <nav>
      <header onClick={toggleDrawer} class={drawerHeader(theme)}>
        <Icons color={theme.text} icon="back" />
        <span>Back</span>
      </header>
      <NavLinks links={linkMap} theme={theme} />
    </nav>
  </aside>
);

export default DrawerMenu;
