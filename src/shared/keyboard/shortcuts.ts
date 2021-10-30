export interface IKeyboardShortcut {
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
}

export interface IShortcutInfo extends IKeyboardShortcut {
  title: string;
  displayKey: string;
  secondary?: IKeyboardShortcut[];
}

type DisplayableShortcuts =
  | 'home'
  | 'subscriptions'
  | 'recents'
  | 'settings'
  | 'search'
  | 'theme'
  | 'info'
  | 'queue'
  | 'togglePlayback'
  | 'seekBack'
  | 'seekAhead'
  | 'seekTo'
  | 'nextEpisode'
  | 'previousEpisode'
  | 'bumpRate'
  | 'decreaseRate'
  | 'mute'
  | 'shortcuts';

export const shortcuts: Record<DisplayableShortcuts, IShortcutInfo> = {
  home: {
    title: 'Home / Top',
    key: 'h',
    displayKey: 'h',
    metaKey: false,
    shiftKey: false,
  },
  subscriptions: {
    title: 'Subscriptions',
    key: 's',
    displayKey: 's',
    metaKey: false,
    shiftKey: false,
  },
  recents: {
    title: 'Recents',
    key: 'r',
    displayKey: 'r',
    metaKey: false,
    shiftKey: false,
  },
  settings: {
    title: 'Settings',
    key: ',',
    displayKey: ',',
    metaKey: false,
    shiftKey: false,
  },
  search: {
    title: 'Search',
    key: '/',
    displayKey: '/',
    metaKey: false,
    shiftKey: false,
  },
  theme: {
    title: 'Toggle theme',
    key: 't',
    displayKey: 't',
    metaKey: false,
    shiftKey: false,
  },
  info: {
    title: 'Show episode info',
    key: 'i',
    displayKey: 'i',
    metaKey: false,
    shiftKey: false,
  },
  queue: {
    title: 'Queue',
    key: 'q',
    displayKey: 'q',
    metaKey: false,
    shiftKey: false,
  },
  togglePlayback: {
    title: 'Play / Pause',
    key: 'k',
    displayKey: 'k',
    metaKey: false,
    shiftKey: false,
    secondary: [
      {
        key: ' ',
        metaKey: false,
        shiftKey: false,
      },
    ],
  },
  seekBack: {
    title: 'Seek back',
    key: 'j',
    displayKey: 'j',
    metaKey: false,
    shiftKey: false,
    secondary: [
      {
        key: 'ArrowLeft',
        metaKey: false,
        shiftKey: false,
      },
    ],
  },
  seekAhead: {
    title: 'Seek ahead',
    key: 'l',
    displayKey: 'l',
    metaKey: false,
    shiftKey: false,
    secondary: [
      {
        key: 'ArrowRight',
        metaKey: false,
        shiftKey: false,
      },
    ],
  },
  seekTo: {
    title: 'Seek to n %',
    key: '*',
    displayKey: '0-9',
    metaKey: false,
    shiftKey: false,
  },
  nextEpisode: {
    title: 'Next episode',
    key: 'N',
    displayKey: 'shift + n',
    metaKey: false,
    shiftKey: true,
  },
  previousEpisode: {
    title: 'Previous episode',
    key: 'P',
    displayKey: 'shift + p',
    metaKey: false,
    shiftKey: true,
  },
  bumpRate: {
    title: 'Increase playback rate',
    key: '>',
    displayKey: '>',
    metaKey: false,
    shiftKey: false,
  },
  decreaseRate: {
    title: 'Lower playback rate',
    key: '<',
    displayKey: '<',
    metaKey: false,
    shiftKey: false,
  },
  mute: {
    title: 'Toggle mute',
    key: 'm',
    displayKey: 'm',
    metaKey: false,
    shiftKey: false,
  },
  shortcuts: {
    title: 'Show shortcuts',
    key: '?',
    displayKey: 'shift + ?',
    metaKey: false,
    shiftKey: true,
  },
};
