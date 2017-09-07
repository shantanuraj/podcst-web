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
  State,
} from './root';

import {
  opmltoJSON,
} from '../utils';

import Podcasts from '../api/Podcasts';

interface AddSubscriptionAction {
  type: 'ADD_SUBSCRIPTION';
  feed: string;
  podcasts: App.EpisodeListing;
}
const ADD_SUBSCRIPTION: AddSubscriptionAction['type'] = 'ADD_SUBSCRIPTION';
export const addSubscription = (
  feed: string,
  podcasts: App.EpisodeListing
): AddSubscriptionAction => ({
  type: ADD_SUBSCRIPTION,
  feed,
  podcasts,
});

interface RemoveSubscriptionAction {
  type: 'REMOVE_SUBSCRIPTION';
  feed: string;
}
const REMOVE_SUBSCRIPTION: RemoveSubscriptionAction['type'] = 'REMOVE_SUBSCRIPTION';
export const removeSubscription = (feed: string): RemoveSubscriptionAction => ({
  type: REMOVE_SUBSCRIPTION,
  feed,
});

interface ParseOPMLAction {
  type: 'PARSE_OPML';
  file: string;
}
const PARSE_OPML: ParseOPMLAction['type'] = 'PARSE_OPML';
export const parseOPML = (file: string): ParseOPMLAction => ({
  type: PARSE_OPML,
  file,
});

export type SubscriptionsActions =
  AddSubscriptionAction |
  RemoveSubscriptionAction |
  ParseOPMLAction;

export interface SubscriptionsState {
  subs: SubscriptionsMap;
}

export const parseOPMLEpic: Epic<SubscriptionsActions, State> =
  action$ => action$.ofType(PARSE_OPML)
    .mergeMap((action: ParseOPMLAction) => {
      const {
        feeds,
      } = opmltoJSON(action.file);

      return Observable.of(
        feeds.map(({ feed }) =>
          Podcasts.episodes(feed)
            .filter(e => e !== null)
            .map((e: App.EpisodeListing) => addSubscription(feed, e))
        )
      );
    })
    .flatMap(e => e)
    .flatMap(e => e);

export const subscriptions = (
  state: SubscriptionsState = {
    subs: {},
  },
  action: SubscriptionsActions,
): SubscriptionsState => {
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
}