/**
 * Actions and Reducer for Search
 */

import { Epic } from 'redux-observable';

import { Observable } from 'rxjs/Observable';

import Podcasts from '../api/Podcasts';

import { IState } from './root';

interface ISearchPodcastsAction {
  type: 'SEARCH_PODCASTS';
  query: string;
}
const SEARCH_PODCASTS: ISearchPodcastsAction['type'] = 'SEARCH_PODCASTS';
export const searchPodcasts = (query: ISearchPodcastsAction['query']): ISearchPodcastsAction | IDismissSearchAction =>
  query
    ? {
        type: SEARCH_PODCASTS,
        query,
      } as ISearchPodcastsAction
    : dismissSearch();

interface ISearchPodcastsSuccessAction {
  type: 'SEARCH_PODCASTS_SUCCESS';
  podcasts: App.IPodcast[];
}
const SEARCH_PODCASTS_SUCCESS: ISearchPodcastsSuccessAction['type'] = 'SEARCH_PODCASTS_SUCCESS';
export const searchPodcastsSuccess = (podcasts: App.IPodcast[]): ISearchPodcastsSuccessAction => ({
  type: SEARCH_PODCASTS_SUCCESS,
  podcasts,
});

interface IDismissSearchAction {
  type: 'DISMISS_SEARCH';
}
const DISMISS_SEARCH: IDismissSearchAction['type'] = 'DISMISS_SEARCH';
export const dismissSearch = (): IDismissSearchAction => ({
  type: DISMISS_SEARCH,
});

interface INavigateResultAction {
  type: 'NAVIGATE_RESULT';
  direction: 'up' | 'down';
}
const NAVIGATE_RESULT: INavigateResultAction['type'] = 'NAVIGATE_RESULT';
export const navigateResult = (direction: INavigateResultAction['direction']): INavigateResultAction => ({
  type: NAVIGATE_RESULT,
  direction,
});

interface IFocusResultAction {
  type: 'FOCUS_RESULT';
  focusedResult: number;
}
const FOCUS_RESULT: IFocusResultAction['type'] = 'FOCUS_RESULT';
export const focusResult = (focusedResult: number): IFocusResultAction => ({
  type: FOCUS_RESULT,
  focusedResult,
});

export interface ISearchState {
  focusedResult: number;
  podcasts: App.IPodcastSearchResult[];
  query: ISearchPodcastsAction['query'];
  searching: boolean;
}

export type SearchActions =
  | ISearchPodcastsAction
  | ISearchPodcastsSuccessAction
  | IDismissSearchAction
  | INavigateResultAction
  | IFocusResultAction;

export const searchPodcastsEpic: Epic<SearchActions, IState> = action$ =>
  action$
    .ofType(SEARCH_PODCASTS)
    .debounceTime(200)
    .switchMap((action: ISearchPodcastsAction) => {
      return action.query.length === 0
        ? Observable.of(searchPodcastsSuccess([]))
        : Podcasts.search(action.query).map(searchPodcastsSuccess);
    });

export const search = (
  state: ISearchState = {
    focusedResult: 0,
    podcasts: [],
    query: '',
    searching: false,
  },
  action: SearchActions,
): ISearchState => {
  switch (action.type) {
    case SEARCH_PODCASTS: {
      return { ...state, query: action.query, searching: true };
    }
    case SEARCH_PODCASTS_SUCCESS: {
      return { ...state, podcasts: action.podcasts, searching: false };
    }
    case DISMISS_SEARCH: {
      return { ...state, focusedResult: 0, podcasts: [], query: '', searching: false };
    }
    case NAVIGATE_RESULT: {
      const { direction } = action;
      const { focusedResult, podcasts } = state;
      const newPos = (focusedResult + (direction === 'up' ? -1 : 1)) % podcasts.length;
      const navigatedResult = newPos > -1 ? newPos : podcasts.length > 0 ? podcasts.length - 1 : 0;
      return { ...state, focusedResult: navigatedResult };
    }
    case FOCUS_RESULT: {
      const { focusedResult } = action;
      return { ...state, focusedResult };
    }
    default:
      return state;
  }
};
