export interface IShortcutInfo {
  title: string;
  key: string;
  metaKey?: boolean;
}

export const shortcuts = {
  home: {
    title: 'Home / Top',
    key: 'h',
    metaKey: false,
  },
  subscriptions: {
    title: 'Subscriptions',
    key: 's',
    metaKey: false,
  },
  recents: {
    title: 'Recents',
    key: 'r',
    metaKey: false,
  },
  settings: {
    title: 'Settings',
    key: ',',
    metaKey: false,
  },
  drawer: {
    title: 'Toggle drawer',
    key: 'd',
    metaKey: false,
  },
  search: {
    title: 'Search',
    key: 'k',
    metaKey: true,
  },
  theme: {
    title: 'Toggle theme',
    key: 't',
    metaKey: false,
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
