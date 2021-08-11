export interface IShortcutInfo {
  title: string;
  key: string;
  metaKey?: boolean;
}

export const shortcuts = {
  home: {
    title: 'Home / Top',
    key: 'h',
  },
  subscriptions: {
    title: 'Subscriptions',
    key: 's',
  },
  recents: {
    title: 'Recents',
    key: 'r',
  },
  settings: {
    title: 'Settings',
    key: ',',
  },
  drawer: {
    title: 'Toggle drawer',
    key: 'd',
  },
  search: {
    title: 'Search',
    key: 'k',
    metaKey: true,
  },
  theme: {
    title: 'Toggle theme',
    key: 't',
  },
  // {
  //   title: 'Show episode info',
  //   value: 'e',
  // },
  // {
  //   title: 'Play / Pause',
  //   value: 'space',
  // },
  // {
  //   title: 'Seek back',
  //   value: 'left',
  // },
  // {
  //   title: 'Seek ahead',
  //   value: 'right',
  // },
  // {
  //   title: 'Seek to n %',
  //   value: '0-9',
  // },
} as const;
