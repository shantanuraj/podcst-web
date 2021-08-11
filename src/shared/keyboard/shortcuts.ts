export interface IShortcutInfo {
  title: string;
  value: string;
}

export const shortcuts = {
  home: {
    title: 'Home / Top',
    value: 'h',
  },
  subscriptions: {
    title: 'Subscriptions',
    value: 's',
  },
  recents: {
    title: 'Recents',
    value: 'r',
  },
  settings: {
    title: 'Settings',
    value: ',',
  },
  drawer: {
    title: 'Toggle drawer',
    value: 'd',
  },
  search: {
    title: 'Search',
    value: 'cmd/ctrl + k',
  },
  theme: {
    title: 'Toggle theme',
    value: 't',
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
