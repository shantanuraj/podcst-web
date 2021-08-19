export interface IShortcutInfo {
  title: string;
  key: string;
  displayKey: string;
  metaKey: boolean;
}

export const shortcuts = {
  home: {
    title: 'Home / Top',
    key: 'h',
    displayKey: 'h',
    metaKey: false,
  },
  subscriptions: {
    title: 'Subscriptions',
    key: 's',
    displayKey: 's',
    metaKey: false,
  },
  recents: {
    title: 'Recents',
    key: 'r',
    displayKey: 'r',
    metaKey: false,
  },
  settings: {
    title: 'Settings',
    key: ',',
    displayKey: ',',
    metaKey: false,
  },
  drawer: {
    title: 'Toggle drawer',
    key: 'd',
    displayKey: 'd',
    metaKey: false,
  },
  search: {
    title: 'Search',
    key: '/',
    displayKey: '/',
    metaKey: false,
  },
  theme: {
    title: 'Toggle theme',
    key: 't',
    displayKey: 't',
    metaKey: false,
  },
  info: {
    title: 'Show episode info',
    key: 'i',
    displayKey: 'i',
    metaKey: false,
  },
  togglePlayback: {
    title: 'Play / Pause',
    key: ' ',
    displayKey: 'space',
    metaKey: false,
  },
  seekBack: {
    title: 'Seek back',
    key: 'ArrowLeft',
    displayKey: 'left',
    metaKey: false,
  },
  seekAhead: {
    title: 'Seek ahead',
    key: 'ArrowRight',
    displayKey: 'right',
    metaKey: false,
  },
  seekTo: {
    title: 'Seek to n %',
    key: '*',
    displayKey: '0-9',
    metaKey: false,
  },
  bumpRate: {
    title: 'Increase playback rate',
    key: '>',
    displayKey: '>',
    metaKey: false,
  },
  decreaseRate: {
    title: 'Lower playback rate',
    key: '<',
    displayKey: '<',
    metaKey: false,
  },
  closeDrawer: {
    title: 'Close drawer',
    key: 'Escape',
    displayKey: 'esc',
    metaKey: false,
  },
} as const;
