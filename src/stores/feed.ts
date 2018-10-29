/**
 * Feed actions / reducers
 */

import { Epic } from 'redux-observable';

import { map, mergeMap } from 'rxjs/operators';

import { IState } from './root';

import Podcasts from '../api/Podcasts';

import { App, FeedType } from '../typings';

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
  podcasts: App.IPodcast[];
}

const GET_FEED_SUCCESS: IGetFeedSuccessAction['type'] = 'GET_FEED_SUCCESS';

const getFeedSuccess = (feedType: FeedType, podcasts: App.IPodcast[]): IGetFeedSuccessAction => ({
  type: GET_FEED_SUCCESS,
  feedType,
  podcasts,
});

export type FeedActions = IGetFeedAction | IGetFeedSuccessAction;

export interface IFeedData {
  loading: boolean;
  podcasts: App.IPodcast[];
}

export interface IFeedState {
  top: IFeedData;
}

// Get feed epic
export const getFeedEpic: Epic<FeedActions, IGetFeedSuccessAction, IState> = action$ =>
  action$
    .ofType(GET_FEED)
    .pipe(
      mergeMap((action: IGetFeedAction) =>
        Podcasts.feed(action.feedType).pipe(map(podcasts => getFeedSuccess(action.feedType, podcasts))),
      ),
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
