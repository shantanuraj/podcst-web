/**
 * Feed actions / reducers
 */

import {
  Epic,
} from 'redux-observable';

import {
  IState,
} from './root';

import Podcasts from '../api/Podcasts';

interface IGetFeedAction {
  type: 'GET_FEED';
  feedType: FeedType;
}

const GET_FEED: IGetFeedAction['type'] = 'GET_FEED';

export const getFeed = (feedType: FeedType): IGetFeedAction => ({
  type: GET_FEED,
  feedType,
});

interface IGetFeedSuccessAction {
  type: 'GET_FEED_SUCCESS';
  feedType: FeedType;
  podcasts: App.Podcast[];
}

const GET_FEED_SUCCESS: IGetFeedSuccessAction['type'] = 'GET_FEED_SUCCESS';

const getFeedSuccess = (
  feedType: FeedType,
  podcasts: App.Podcast[],
): IGetFeedSuccessAction => ({
  type: GET_FEED_SUCCESS,
  feedType,
  podcasts,
});

export type FeedActions =
  IGetFeedAction |
  IGetFeedSuccessAction;

export interface IFeedData {
  loading: boolean;
  podcasts: App.Podcast[];
}

export interface IFeedState {
  top: IFeedData;
}

// Get feed epic
export const getFeedEpic: Epic<FeedActions, IState> = (action$) =>
  action$
    .ofType(GET_FEED)
    .mergeMap((action: IGetFeedAction) =>
      Podcasts
        .feed(action.feedType)
        .map((podcasts) => getFeedSuccess(action.feedType, podcasts)),
    );

// Feed reducer
export const feed = (
  state: IFeedState = {
    top: {
      loading: false,
      podcasts: [],
    },
  },
  action: FeedActions,
): IFeedState => {
  switch (action.type) {
    case 'GET_FEED':
      return {
        ...state,
        [action.feedType]: {
          ...state[action.feedType],
          loading: true,
        },
      };
    case 'GET_FEED_SUCCESS':
      return {
        ...state,
        [action.feedType]: {
          ...state[action.feedType],
          loading: false,
          podcasts: action.podcasts,
        },
      };
    default:
      return state;
  }
};
