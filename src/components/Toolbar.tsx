/**
 * Toolbar component
 */

import { h } from 'preact';

import { style } from 'typestyle';

import ConnectedSearch from '../containers/ConnectedSearch';

import Icons from '../svg/Icon';

const toolbar = (theme: App.ITheme) =>
  style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: theme.background,
    position: 'fixed',
    top: 0,
    left: 0,
    height: '64px',
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
      <span onClick={toggleDrawer}>
        <Icons color={theme.text} icon="menu" />
      </span>
    </nav>
    <div class={secondaryItems}>
      <ConnectedSearch theme={theme} className={search} />
    </div>
  </header>
);

export default Toolbar;
