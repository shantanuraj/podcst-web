/**
 * Utils for store
 */

import { App } from '../typings';

import { IState, StoreActions } from './root';

import { Storage } from '../utils/storage';

import { SEEK_DELTA } from '../utils/constants';

import { ThemeProvider } from '../styles';
import { IAppState } from './app';

/**
 * Effect descriptior
 */
export interface IEffectDescriptor {
  epic: string;
  error?: boolean;
  payload?: string | number | object;
}

/**
 * Effect action
 */
export interface IEffectAction {
  type: 'EFFECT';
  action: StoreActions | IEffectDescriptor;
}
const EFFECT: IEffectAction['type'] = 'EFFECT';
export const effect = (action: StoreActions | IEffectDescriptor): IEffectAction => ({
  type: EFFECT,
  action,
});

const preferredTheme = () => {
  const prefersLightTheme = matchMedia('(prefers-color-scheme: light)');
  const mode: App.ThemeMode = prefersLightTheme.matches ? 'light' : 'dark';
  return { mode, theme: ThemeProvider(mode) };
};

const defaultAppState: IAppState = {
  ...preferredTheme(),
  title: 'Podcst',
};

/**
 * App default state
 */
export const getDefaultState = (): IState => ({
  app: { ...defaultAppState, ...Storage.getAppState() },
  router: {
    path: '/',
  },
  feed: {
    top: {
      loading: false,
      podcasts: [],
    },
  },
  search: {
    focusedResult: 0,
    podcasts: [],
    query: '',
    searching: false,
  },
  podcasts: {},
  player: {
    buffering: false,
    currentEpisode: 0,
    duration: 0,
    isLargeSeekVisible: false,
    queue: [],
    seekDelta: SEEK_DELTA,
    seekPosition: 0,
    state: 'stopped',
  },
  subscriptions: Storage.getSubscriptions() || {
    subs: {},
    recents: [],
  },
  toast: {
    isVisible: false,
    message: null,
    persistent: false,
  },
  drawer: {
    isVisible: false,
  },
});
