/**
 * Actions / Reducer for subscriptions
 */

import {
  Observable,
} from 'rxjs/Observable';

import {
  Epic,
} from 'redux-observable';

import {
  IState,
} from './root';

import {
  INoopAction,
  noop,
} from './utils';

import {
  opmltoJSON,
} from '../utils';

import {
  Storage,
} from '../utils/storage';

import Podcasts from '../api/Podcasts';

interface IAddSubscriptionAction {
  type: 'ADD_SUBSCRIPTION';
  feed: string;
  podcasts: App.RenderablePodcast;
}
const ADD_SUBSCRIPTION: IAddSubscriptionAction['type'] = 'ADD_SUBSCRIPTION';
export const addSubscription = (
  feed: string,
  podcasts: App.RenderablePodcast,
): IAddSubscriptionAction => ({
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

export type SubscriptionsActions =
  IAddSubscriptionAction |
  IRemoveSubscriptionAction |
  IParseOPMLAction |
  INoopAction;

export interface ISubscriptionsState {
  subs: SubscriptionsMap;
}

export const parseOPMLEpic: Epic<SubscriptionsActions, IState> =
  (action$) => action$.ofType(PARSE_OPML)
    .mergeMap((action: IParseOPMLAction) => {
      const {
        feeds,
      } = opmltoJSON(action.file);

      return Observable.of(
        feeds.map(({ feed }) =>
          Podcasts.episodes(feed)
            .filter((e) => e !== null)
            .map((e: App.EpisodeListing) => addSubscription(feed, { ...e, feed })),
        ),
      );
    })
    .flatMap((e) => e)
    .flatMap((e) => e);

export const subscriptionStateChangeEpic: Epic<SubscriptionsActions, IState> =
  (action$, state) => action$
    .filter(({ type }) => type === ADD_SUBSCRIPTION || type === REMOVE_SUBSCRIPTION)
    .do(() => Storage.saveSubscriptions(state.getState().subscriptions.subs))
    .map(noop);

export const subscriptions = (
  state: ISubscriptionsState = {
    subs: {},
  },
  action: SubscriptionsActions,
): ISubscriptionsState => {
  switch (action.type) {
    case ADD_SUBSCRIPTION:
      return {...state, subs: {
        ...state.subs,
        [action.feed]: action.podcasts,
      }};
    case REMOVE_SUBSCRIPTION:
      return {...state, subs: Object
        .keys(state.subs)
        .reduce((subs, feed) => {
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
