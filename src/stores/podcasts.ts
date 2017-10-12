/**
 * Actions and reducer for Podcasts store
 */

import {
  Epic,
} from 'redux-observable';

import Podcasts from '../api/Podcasts';

import {
  IState,
} from '../stores/root';

interface IGetEpisodesAction {
  type: 'GET_EPISODES';
  feed: App.Podcast['feed'];
}
const GET_EPISODES: IGetEpisodesAction['type'] = 'GET_EPISODES';
export const getEpisodes = (feed: string): IGetEpisodesAction => ({
  type: GET_EPISODES,
  feed,
});

interface IGetEpisodesSuccessAction {
  type: 'GET_EPISODES_SUCCESS';
  episodes: App.PodcastEpisodesInfo | null;
  feed: App.Podcast['feed'];
}
const GET_EPISODES_SUCCESS: IGetEpisodesSuccessAction['type'] = 'GET_EPISODES_SUCCESS';
export const getEpisodesSuccess = (
  feed: string,
  episodes: App.PodcastEpisodesInfo | null,
): IGetEpisodesSuccessAction => ({
  type: GET_EPISODES_SUCCESS,
  episodes,
  feed,
});

export type PodcastsAction =
  IGetEpisodesAction |
  IGetEpisodesSuccessAction;

export interface IPodcastsState {
  [feed: string]: {
    episodes: App.PodcastEpisodesInfo | null;
    loading: boolean;
  };
}

/**
 * Get episodes epic
 */
export const getEpisodesEpic: Epic<PodcastsAction, IState> = (action$) =>
  action$
    .ofType(GET_EPISODES)
    .mergeMap((action: IGetEpisodesAction) =>
      Podcasts
        .episodes(action.feed)
        .map((episodes) => getEpisodesSuccess(action.feed, episodes)),
    );

export const podcasts = (state: IPodcastsState = {}, action: PodcastsAction): IPodcastsState => {
  switch (action.type) {
    case GET_EPISODES:
      return {...state, [action.feed]: {
        ...state[action.feed],
        loading: true,
      }};
    case GET_EPISODES_SUCCESS:
      return {...state, [action.feed]: {
        ...state[action.feed],
        episodes: action.episodes,
        loading: false,
      }};
    default:
      return state;
  }
};
