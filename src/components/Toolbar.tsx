/**
 * Toolbar component
 */

import * as React from 'react';

import { Link } from 'react-router-dom';

import { media, style } from 'typestyle';

import ConnectedSearch from '../containers/ConnectedSearch';

import { TOOLBAR_HEIGHT } from '../utils/constants';

import { App } from '../typings';

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
    $nest: {
      '& nav': {
        padding: 16,
        flex: 1,
      },
    },
  });

const logo = style(
  {
    background: '#e3e3e3',
    width: '8rem',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  media(
    { minWidth: 600 },
    {
      width: '20rem',
    },
  ),
);

const secondaryItems = style({
  display: 'flex',
  alignItems: 'center',
  height: '100%',
  flex: 1,
});

const profile = style({
  marginLeft: 'auto',
  paddingLeft: '0.25rem',
  paddingRight: '0.5rem',
  display: 'flex',
  alignItems: 'center',
  $nest: {
    img: {
      borderRadius: '50%',
      width: '3rem',
      height: '3rem',
      objectFit: 'cover',
    },
  },
});

const search = style({
  height: 'inherit',
  padding: '0.5rem',
  width: '100%',
});

interface IToolbarProps {
  title: string;
  theme: App.ITheme;
}

const Toolbar = ({ theme }: IToolbarProps) => (
  <header className={toolbar(theme)}>
    <Link to="/" className={logo}>
      PODCST
    </Link>
    <div className={secondaryItems}>
      <ConnectedSearch className={search} />
    </div>
    <Link to="/" className={profile}>
      <img src="https://images.unsplash.com/photo-1511485977113-f34c92461ad9?ixlib=rb-1.2.1&q=80&fm=jpg" />
    </Link>
  </header>
);

export default Toolbar;
