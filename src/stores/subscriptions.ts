/**
 * Actions / Reducer for subscriptions
 */

import { concat, of } from 'rxjs';

import { filter, map, mergeMap, tap } from 'rxjs/operators';

import { Epic } from 'redux-observable';

import { Actions, IState } from './root';

import { IShowToastAction, showToast } from './toast';

import { GET_EPISODES_SUCCESS, IGetEpisodesSuccessAction } from './podcasts';

import { INoopAction, noop } from './utils';

import { notNull, opmltoJSON } from '../utils';

import { recents } from '../utils/recents';

import { Storage } from '../utils/storage';

import Podcasts from '../api/Podcasts';

import { App, ISubscriptionsMap } from '../typings';

interface IAddSubscriptionAction {
  type: 'ADD_SUBSCRIPTION';
  feed: string;
  podcasts: App.IPodcastEpisodesInfo;
}
const ADD_SUBSCRIPTION: IAddSubscriptionAction['type'] = 'ADD_SUBSCRIPTION';
export const addSubscription = (feed: string, podcasts: App.IPodcastEpisodesInfo): IAddSubscriptionAction => ({
  type: ADD_SUBSCRIPTION,
  feed,
  podcasts,
});

interface IRemoveSubscriptionAction {
  type: 'REMOVE_SUBSCRIPTION';
  feed: string;
}
const REMOVE_SUBSCRIPTION: IRemoveSubscriptionAction['type'] = 'REMOVE_SUBSCRIPTION';
export const removeSubscription = (feed: string): IRemoveSubscriptionAction => ({
  type: REMOVE_SUBSCRIPTION,
  feed,
});

interface IParseOPMLAction {
  type: 'PARSE_OPML';
  file: string;
}
const PARSE_OPML: IParseOPMLAction['type'] = 'PARSE_OPML';
export const parseOPML = (file: string): IParseOPMLAction => ({
  type: PARSE_OPML,
  file,
});

export type SubscriptionsActions = IAddSubscriptionAction | IRemoveSubscriptionAction | IParseOPMLAction | INoopAction;

export interface ISubscriptionsState {
  subs: ISubscriptionsMap;
  recents: App.IEpisodeInfo[];
}

export const parseOPMLEpic: Epic<Actions, IShowToastAction | IAddSubscriptionAction, IState> = action$ =>
  action$.ofType(PARSE_OPML).pipe(
    mergeMap((action: IParseOPMLAction) => {
      const { feeds } = opmltoJSON(action.file);

      const addSubscriptions = feeds.map(({ feed }) =>
        Podcasts.episodes(feed).pipe(
          filter(notNull),
          map((podcasts: App.IPodcastEpisodesInfo) => addSubscription(feed, podcasts)),
        ),
      );

      const actions = [
        of(showToast(`Importing ${feeds.length} feed${feeds.length > 1 ? 's' : ''}`, true)),
        ...addSubscriptions,
        of(showToast('Import successful!')),
      ];
      return concat(...actions);
    }),
  );

export const subscriptionStateChangeEpic: Epic<SubscriptionsActions, INoopAction, IState> = (action$, state$) =>
  action$.pipe(
    filter(({ type }) => type === ADD_SUBSCRIPTION || type === REMOVE_SUBSCRIPTION),
    tap(() => Storage.saveSubscriptions(state$.value.subscriptions)),
    map(noop),
  );

export const syncSubscriptionEpic: Epic<Actions, IAddSubscriptionAction, IState> = (action$, state$) =>
  action$
    .ofType(GET_EPISODES_SUCCESS)
    .pipe(
      filter(({ episodes, feed }: IGetEpisodesSuccessAction) => !!episodes && feed in state$.value.subscriptions.subs),
      map((action: IGetEpisodesSuccessAction) =>
        addSubscription(action.feed, { ...action.episodes!, feed: action.feed }),
      ),
    );

export const subscriptions = (
  state: ISubscriptionsState = {
    subs: {},
    recents: [],
  },
  action: SubscriptionsActions,
): ISubscriptionsState => {
  switch (action.type) {
    case ADD_SUBSCRIPTION: {
      const subs = {
        ...state.subs,
        [action.feed]: action.podcasts,
      };
      return {
        ...state,
        subs,
        recents: recents(subs),
      };
    }
    case REMOVE_SUBSCRIPTION: {
      const subs = Object.keys(state.subs)
        .filter(feed => feed !== action.feed)
        .reduce((acc, feed) => ({ ...acc, [feed]: state.subs[feed] }), {} as ISubscriptionsMap);
      return {
        ...state,
        subs,
        recents: recents(subs),
      };
    }
    default:
      return state;
  }
};
