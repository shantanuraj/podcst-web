/**
 * Utils for store
 */

import {
  State,
} from './root';

import {
  Storage,
} from '../utils/storage';

import {
  ThemeProvider,
} from '../styles';

/**
 * Noop action
 */
export interface NoopAction {
  type: 'NOOP';
}
const NOOP: NoopAction['type'] = 'NOOP';
export const noop = (): NoopAction => ({ type: NOOP });

/**
 * App default state
 */
export const getDefaultState = (): State => ({
  app: Storage.getAppState() || {
    mode: 'dark',
    theme: ThemeProvider('dark'),
  },
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
    podcasts: [],
    query: '',
    searching: false,
    focusedResult: 0,
  },
  podcasts: {},
  player: {
    currentEpisode: 0,
    queue: [],
    state: 'stopped',
    seekPosition: 0,
    duration: 0,
    buffering: false,
  },
  subscriptions: {
    subs: Storage.getSubscriptions(),
  },
});
