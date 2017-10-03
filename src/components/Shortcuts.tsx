/**
 * Shortcuts component
 */

import {
  h,
} from 'preact';

import {
  media,
  style,
} from 'typestyle';

const container = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
});

const item = (theme: App.Theme) => style(
  {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 32,
    color: theme.text,
    fontSize: 18,
  }, {
  $nest: {
    '&:nth-child(even)': {
      backgroundColor: theme.backgroundLight,
    },
  },
}, media({ maxWidth: 600 }, {
  paddingLeft: 16,
  paddingRight: 16,
}));

interface ShortcutInfo {
  title: string;
  value: string;
}

const shortcuts: ShortcutInfo[] = [
  {
    title: 'Search',
    value: 's',
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
];

const renderShortcut = (theme: App.Theme) => ({
  title,
  value,
}: ShortcutInfo) => (
  <div class={item(theme)}>
    <span>{title}</span>
    <pre>{value}</pre>
  </div>
);

const renderShortcuts = (theme: App.Theme, shortcuts: ShortcutInfo[]) => (
  shortcuts.map(renderShortcut(theme))
);

interface ShortcutsProps {
  theme: App.Theme;
}

const Shortcuts = ({
  theme,
}: ShortcutsProps) => (
  <div class={container}>
    {renderShortcuts(theme, shortcuts)}
  </div>
);

export default Shortcuts;
