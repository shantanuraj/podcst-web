/**
 * Actions and Reducer for Search
 */

import {
  Epic,
} from 'redux-observable';

import {
  Observable,
} from 'rxjs/Observable';

import Podcasts from '../api/Podcasts';

import {
  State,
} from './root';

interface SearchPodcastsAction {
  type: 'SEARCH_PODCASTS';
  query: string;
}
const SEARCH_PODCASTS: SearchPodcastsAction['type'] = 'SEARCH_PODCASTS';
export const searchPodcasts = (query: SearchPodcastsAction['query']) => ({
  type: SEARCH_PODCASTS,
  query,
});

interface SearchPodcastsSuccessAction {
  type: 'SEARCH_PODCASTS_SUCCESS';
  podcasts: App.Podcast[];
}
const SEARCH_PODCASTS_SUCCESS: SearchPodcastsSuccessAction['type'] = 'SEARCH_PODCASTS_SUCCESS';
export const searchPodcastsSuccess = (podcasts: App.Podcast[]) => ({
  type: SEARCH_PODCASTS_SUCCESS,
  podcasts,
});

interface DismissSearchAction {
  type: 'DISMISS_SEARCH';
}
const DISMISS_SEARCH: DismissSearchAction['type'] = 'DISMISS_SEARCH';
export const dismissSearch = () => ({
  type: DISMISS_SEARCH,
});

interface NavigateResultAction {
  type: 'NAVIGATE_RESULT',
  direction: 'up' | 'down',
}
const NAVIGATE_RESULT: NavigateResultAction['type'] = 'NAVIGATE_RESULT';
export const navigateResult = (direction: NavigateResultAction['direction']): NavigateResultAction => ({
  type: NAVIGATE_RESULT,
  direction,
});

export interface SearchState {
  query: SearchPodcastsAction['query'];
  podcasts: App.Podcast[];
  searching: boolean;
  focusedResult: number;
}

export type SearchActions =
  SearchPodcastsAction |
  SearchPodcastsSuccessAction |
  DismissSearchAction |
  NavigateResultAction;

export const searchPodcastsEpic: Epic<SearchActions, State> = action$ =>
  action$.ofType(SEARCH_PODCASTS)
    .debounceTime(200)
    .switchMap((action: SearchPodcastsAction) => {
      return action.query.length === 0 ?
        Observable.of(searchPodcastsSuccess([])) :
        Podcasts.search(action.query)
          .map(searchPodcastsSuccess);
    });

export const search = (state: SearchState = {
  query: '',
  podcasts: [],
  searching: false,
  focusedResult: 0,
}, action: SearchActions): SearchState => {
  switch(action.type) {
    case SEARCH_PODCASTS: {
      return {...state, query: action.query, searching: true};
    }
    case SEARCH_PODCASTS_SUCCESS: {
      return {...state, podcasts: action.podcasts, searching: false};
    }
    case DISMISS_SEARCH: {
      return {...state, query: '', podcasts: [], searching: false};
    }
    case NAVIGATE_RESULT: {
      const { direction } = action;
      const {
        focusedResult,
        podcasts,
      } = state;
      const newPos = (focusedResult + (direction === 'up' ? -1 : 1)) % podcasts.length;
      const navigatedResult = (newPos > -1) ? newPos :  (podcasts.length > 0 ? podcasts.length - 1 : 0);
      return {...state, focusedResult: navigatedResult};
    }
    default:
      return state;
  }
}
