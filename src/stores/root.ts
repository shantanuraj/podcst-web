/**
 * Redux store root entities
 */

import { combineEpics, Epic } from 'redux-observable';

import { combineReducers } from 'redux';

import { INoopAction } from './utils';

import { IRouterState, router, RouterActions, routerEpic, routeTitleSyncEpic } from './router';

import { getEpisodesEpic, IPodcastsState, podcasts, PodcastsAction } from './podcasts';

import { audioSeekUpdateEpic, IPlayerState, player, PlayerActions, playerAudioEpic, uiSeekUpdateEpic } from './player';

import { feed, FeedActions, getFeedEpic, IFeedState } from './feed';

import { ISearchState, search, SearchActions, searchPodcastsEpic } from './search';

import { drawer, DrawerActions, drawerCloseEpic, IDrawerState } from './drawer';

import {
  ISubscriptionsState,
  parseOPMLEpic,
  subscriptions,
  SubscriptionsActions,
  subscriptionStateChangeEpic,
  syncSubscriptionEpic,
} from './subscriptions';

import {
  app,
  AppActions,
  chromeMediaMetadaUpdateEpic,
  fixGlobalThemeEpic,
  IAppState,
  saveAppStateEpic,
  updateTitleEpic,
} from './app';

import { dismissToastEpic, IToastState, toast, ToastActions } from './toast';

import { changeThemeEpic, openViewEpic, playerControlsEpic, seekbarJumpsEpic } from './keyboard';

/**
 * Combined application actions interface
 */
export type Actions =
  | RouterActions
  | FeedActions
  | SearchActions
  | PodcastsAction
  | PlayerActions
  | SubscriptionsActions
  | AppActions
  | ToastActions
  | DrawerActions
  | INoopAction;

/**
 * Combined application state interface
 */
export interface IState {
  app: IAppState;
  router: IRouterState;
  feed: IFeedState;
  search: ISearchState;
  podcasts: IPodcastsState;
  player: IPlayerState;
  subscriptions: ISubscriptionsState;
  toast: IToastState;
  drawer: IDrawerState;
}

const epics: Array<Epic<Actions, IState, any>> = [
  // router epics
  routerEpic,
  routeTitleSyncEpic,

  getFeedEpic,
  searchPodcastsEpic,
  getEpisodesEpic,
  playerAudioEpic,
  uiSeekUpdateEpic,
  audioSeekUpdateEpic,
  parseOPMLEpic,
  subscriptionStateChangeEpic,
  syncSubscriptionEpic,
  changeThemeEpic,

  // app state epics
  fixGlobalThemeEpic,
  updateTitleEpic,
  saveAppStateEpic,

  'mediaSession' in navigator ? chromeMediaMetadaUpdateEpic : null,
  playerControlsEpic,
  seekbarJumpsEpic,
  openViewEpic,
  dismissToastEpic,
  drawerCloseEpic,
].filter(epic => epic !== null) as Array<Epic<Actions, IState, any>>;

export const rootEpic = combineEpics<Actions, IState>(...epics);

export const rootReducer = combineReducers<IState>({
  app,
  feed,
  player,
  podcasts,
  router,
  search,
  subscriptions,
  toast,
  drawer,
});
