/**
 * Actions / Reducer for subscriptions
 */

import { of } from 'rxjs/observable/of';

import { concat } from 'rxjs/observable/concat';

import { Epic } from 'redux-observable';

import { Actions, IState } from './root';

import { showToast } from './toast';

import { GET_EPISODES_SUCCESS, IGetEpisodesSuccessAction } from './podcasts';

import { INoopAction, noop } from './utils';

import { notNull, opmltoJSON } from '../utils';

import { Storage } from '../utils/storage';

import Podcasts from '../api/Podcasts';

interface IAddSubscriptionAction {
  type: 'ADD_SUBSCRIPTION';
  feed: string;
  podcasts: App.RenderablePodcast;
}
const ADD_SUBSCRIPTION: IAddSubscriptionAction['type'] = 'ADD_SUBSCRIPTION';
export const addSubscription = (feed: string, podcasts: App.RenderablePodcast): IAddSubscriptionAction => ({
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
}

export const parseOPMLEpic: Epic<Actions, IState> = action$ =>
  action$.ofType(PARSE_OPML).mergeMap((action: IParseOPMLAction) => {
    const { feeds } = opmltoJSON(action.file);

    const addSubscriptions = feeds.map(({ feed }) =>
      Podcasts.episodes(feed)
        .filter(notNull)
        .map((podcasts: App.IPodcastEpisodesInfo) => addSubscription(feed, { ...podcasts, feed })),
    );

    const actions = [
      of(showToast(`Importing ${feeds.length} feed${feeds.length > 1 ? 's' : ''}`, true)),
      ...addSubscriptions,
      of(showToast('Import successful!')),
    ];
    return concat(...actions);
  });

export const subscriptionStateChangeEpic: Epic<SubscriptionsActions, IState> = (action$, state) =>
  action$
    .filter(({ type }) => type === ADD_SUBSCRIPTION || type === REMOVE_SUBSCRIPTION)
    .do(() => Storage.saveSubscriptions(state.getState().subscriptions.subs))
    .map(noop);

export const syncSubscriptionEpic: Epic<Actions, IState> = (action$, state) =>
  action$
    .ofType(GET_EPISODES_SUCCESS)
    .filter(
      (action: IGetEpisodesSuccessAction) => !!action.episodes && !!state.getState().subscriptions.subs[action.feed],
    )
    .map((action: IGetEpisodesSuccessAction) =>
      addSubscription(action.feed, { ...action.episodes!, feed: action.feed }),
    );

export const subscriptions = (
  state: ISubscriptionsState = {
    subs: {},
  },
  action: SubscriptionsActions,
): ISubscriptionsState => {
  switch (action.type) {
    case ADD_SUBSCRIPTION:
      return {
        ...state,
        subs: {
          ...state.subs,
          [action.feed]: action.podcasts,
        },
      };
    case REMOVE_SUBSCRIPTION:
      return {
        ...state,
        subs: Object.keys(state.subs).reduce((subs, feed) => {
          if (feed !== action.feed) {
            subs[feed] = state.subs[feed];
          }
          return subs;
        }, {}),
      };
    default:
      return state;
  }
};
