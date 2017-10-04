/**
 * Utils for store
 */

import {
  IState,
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
export interface INoopAction {
  type: 'NOOP';
}
const NOOP: INoopAction['type'] = 'NOOP';
export const noop = (): INoopAction => ({ type: NOOP });

/**
 * App default state
 */
export const getDefaultState = (): IState => ({
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
    queue: [],
    seekPosition: 0,
    state: 'stopped',
  },
  subscriptions: {
    subs: Storage.getSubscriptions(),
  },
});
