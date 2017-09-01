/**
 * Texts actions / reducers
 */

import {
  Epic,
} from 'redux-observable';

import {
  cloneDeep,
} from 'lodash-es';

import {
  State,
  Actions,
} from '../stores/root';

import {
  navigate,
} from '../stores/router';

import {
  filterThreads,
  toThreads,
} from '../utils';

import ShareText from '../api/ShareText';

type FetchTexts = 'FETCH_TEXTS';
const FETCH_TEXTS: FetchTexts = 'FETCH_TEXTS';
interface FetchTextsAction {
  type: FetchTexts;
}

/**
 * Action creator for fetching texts
 */
export const fetchTexts = (): FetchTextsAction => ({
  type: FETCH_TEXTS,
});

type FetchTextsFulfilled = 'FETCH_TEXTS_FULFILLED';
const FETCH_TEXTS_FULFILLED: FetchTextsFulfilled = 'FETCH_TEXTS_FULFILLED';
interface FetchTextsFulfilledAction {
  type: FetchTextsFulfilled,
  texts: ShareText.Text[],
}

/**
 * Action creator for storing texts retrieved from server
 * @param texts - Texts retrieved from API
 */
const fetchTextsFulfilled = (texts: ShareText.Text[]): FetchTextsFulfilledAction => ({
  type: FETCH_TEXTS_FULFILLED,
  texts,
});

type SearchTexts = 'SEARCH_TEXTS';
const SEARCH_TEXTS: SearchTexts = 'SEARCH_TEXTS';
interface SearchTextsAction {
  type: SearchTexts;
  query: string;
}

/**
 * Action creator for searching texts
 * @param query - Filter query
 */
export const searchTexts = (query: string): SearchTextsAction => ({
  type: SEARCH_TEXTS,
  query,
});

/**
 * Texts reducer actions
 */
export type TextsActions =
  FetchTextsAction |
  FetchTextsFulfilledAction |
  SearchTextsAction;

/**
 * Texts specific state
 */
export interface TextsState {
  loading: boolean;
  texts: ShareText.Text[];
  threads: ShareText.TextThread[];
  filteredThreads: ShareText.TextThread[];
  query: string;
}

/**
 * Fetch texts epic
 */
export const fetchTextsEpic: Epic<TextsActions, State> = (action$, store) =>
  action$.ofType(FETCH_TEXTS)
    .mergeMap(() => {
      const {
        host,
        code,
      } = store.getState().auth;
      return new ShareText(host, code)
      .getTexts()
      .map(fetchTextsFulfilled)
    });

/**
 * Search texts epic
 */
export const searchTextsEpic: Epic<Actions, State> = action$ =>
  action$.ofType(SEARCH_TEXTS)
    .map((action: SearchTextsAction) =>
      action.query ?
      `/texts?q=${encodeURIComponent(action.query)}` :
      `/texts`
    )
    .map(navigate);

/**
 * Texts reducer
 */
export const texts = (state: TextsState = {
  loading: false,
  texts: [],
  threads: [],
  filteredThreads: [],
  query: '',
}, action: TextsActions): TextsState => {
  switch (action.type) {
    case FETCH_TEXTS:
      return { ...state, loading: true };
    case FETCH_TEXTS_FULFILLED:
      const threads = toThreads(action.texts);
      return {
        ...state,
        loading: false,
        texts: action.texts,
        threads,
        filteredThreads: cloneDeep(threads),
      };
    case SEARCH_TEXTS:
      return {
        ...state,
        query: action.query,
        filteredThreads: filterThreads(state.threads, action.query),
      };
    default:
      return state;
  }
}
