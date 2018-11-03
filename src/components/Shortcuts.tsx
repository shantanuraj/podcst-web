/**
 * Shortcuts component
 */

import * as React from 'react';

import { media, style } from 'typestyle';

import { App } from '../typings';

const container = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
});

const item = (theme: App.ITheme) =>
  style(
    {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 32,
      color: theme.text,
      fontSize: 18,
    },
    {
      $nest: {
        '&:nth-child(even)': {
          backgroundColor: theme.backgroundLight,
        },
      },
    },
    media(
      { maxWidth: 600 },
      {
        paddingLeft: 16,
        paddingRight: 16,
      },
    ),
  );

interface IShortcutInfo {
  title: string;
  value: string;
}

const appShortcuts: IShortcutInfo[] = [
  {
    title: 'Search',
    value: 's',
  },
  {
    title: 'Toggle drawer',
    value: 'd',
  },
  {
    title: 'Show episode info',
    value: 'e',
  },
  {
    title: 'Toggle theme',
    value: 't',
  },
  {
    title: 'Play / Pause',
    value: 'space',
  },
  {
    title: 'Seek back',
    value: 'left',
  },
  {
    title: 'Seek ahead',
    value: 'right',
  },
  {
    title: 'Seek to n %',
    value: '0-9',
  },
  {
    title: 'Open settings',
    value: ',',
  },
];

const renderShortcut = (theme: App.ITheme) => ({ title, value }: IShortcutInfo) => (
  <div className={item(theme)}>
    <span>{title}</span>
    <pre>{value}</pre>
  </div>
);

const renderShortcuts = (theme: App.ITheme, shortcuts: IShortcutInfo[]) => shortcuts.map(renderShortcut(theme));

interface IShortcutsProps {
  theme: App.ITheme;
}

const Shortcuts = ({ theme }: IShortcutsProps) => (
  <div className={container}>{renderShortcuts(theme, appShortcuts)}</div>
);

export default Shortcuts;
