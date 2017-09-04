/**
 * Feed actions / reducers
 */

import {
  Epic,
} from 'redux-observable';

import {
  State,
} from './root';

import Podcasts from '../api/Podcasts';

interface GetFeedAction {
  type: 'GET_FEED',
  feed: FeedType;
}

const GET_FEED: GetFeedAction['type'] = 'GET_FEED';

export const getFeed = (feed: FeedType): GetFeedAction => ({
  type: GET_FEED,
  feed,
});

interface GetFeedSuccessAction {
  type: 'GET_FEED_SUCCESS',
  feed: FeedType;
  podcasts: App.Podcast[];
}

const GET_FEED_SUCCESS: GetFeedSuccessAction['type'] = 'GET_FEED_SUCCESS';

const getFeedSuccess = (
  feed: FeedType,
  podcasts: App.Podcast[],
): GetFeedSuccessAction => ({
  type: GET_FEED_SUCCESS,
  feed,
  podcasts,
});

export type FeedActions =
  GetFeedAction |
  GetFeedSuccessAction;

export interface FeedData {
  podcasts: App.Podcast[];
  loading: boolean;
}

export interface FeedState {
  top: FeedData;
}

// Get feed epic
export const getFeedEpic: Epic<FeedActions, State> = action$ =>
  action$
    .ofType(GET_FEED)
    .mergeMap((action: GetFeedAction) =>
      Podcasts
        .feed(action.feed)
        .map(podcasts => getFeedSuccess(action.feed, podcasts))
    );

// Feed reducer
export const feed = (state: FeedState = {
  top: {
    loading: false,
    podcasts: [],
  },
}, action: FeedActions): FeedState => {
  switch (action.type) {
    case 'GET_FEED':
      return {
        ...state,
        [action.feed]: {
          ...state[action.feed],
          loading: true,
        },
      };
    case 'GET_FEED_SUCCESS':
      return {
        ...state,
        [action.feed]: {
          ...state[action.feed],
          loading: false,
          podcasts: action.podcasts,
        },
      };
    default:
      return state;
  }
}
