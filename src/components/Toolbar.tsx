/**
 * Toolbar component
 */

import { h } from 'preact';

import { style } from 'typestyle';

import ConnectedSearch from '../containers/ConnectedSearch';

import Icons from '../svg/Icon';

import { TOOLBAR_HEIGHT } from '../utils/constants';

const toolbar = (theme: App.ITheme) =>
  style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: theme.background,
    position: 'fixed',
    top: 0,
    left: 0,
    height: TOOLBAR_HEIGHT,
    width: '100%',
    zIndex: 501,
    fontSize: 20,
    color: theme.text,
    boxShadow: `0px 4px 4px 0px rgba(0,0,0,0.75)`,
    $nest: {
      '& nav': {
        padding: 16,
        flex: 1,
      },
    },
  });

const menuContainer = style({
  display: 'flex',
  alignItems: 'center',
  $nest: {
    '& span': {
      marginLeft: 16,
    },
  },
});

const secondaryItems = style({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
});

const search = style({
  height: 'inherit',
  paddingLeft: 16,
});

interface IToolbarProps {
  theme: App.ITheme;
  toggleDrawer();
}

const Toolbar = ({ theme, toggleDrawer }: IToolbarProps) => (
  <header class={toolbar(theme)}>
    <nav>
      <div class={menuContainer} onClick={toggleDrawer}>
        <Icons color={theme.text} icon="menu" size={24} />
        <span>Podcasts</span>
      </div>
    </nav>
    <div class={secondaryItems}>
      <ConnectedSearch className={search} />
    </div>
  </header>
);

export default Toolbar;
