/**
 * Actions and reducer for Podcasts store
 */

import {
  Epic
} from 'redux-observable';

import Podcasts from '../api/Podcasts';

import {
  State,
} from '../stores/root';

interface GetEpisodesAction {
  type: 'GET_EPISODES';
  feed: App.Podcast['feed'];
}
const GET_EPISODES: GetEpisodesAction['type'] = 'GET_EPISODES';
export const getEpisodes = (feed: string): GetEpisodesAction => ({
    type: GET_EPISODES,
    feed,
});

interface GetEpisodesSuccessAction {
  type: 'GET_EPISODES_SUCCESS';
  feed: App.Podcast['feed'];
  episodes: App.EpisodeListing | null;
}
const GET_EPISODES_SUCCESS: GetEpisodesSuccessAction['type'] = 'GET_EPISODES_SUCCESS';
export const getEpisodesSuccess = (
  feed: string,
  episodes: App.EpisodeListing | null,
): GetEpisodesSuccessAction => ({
  type: GET_EPISODES_SUCCESS,
  episodes,
  feed,
});

export type PodcastsAction =
  GetEpisodesAction |
  GetEpisodesSuccessAction;

export interface PodcastsState {
  [feed: string]: {
    episodes: App.EpisodeListing | null;
    loading: boolean;
  };
};

// Get episodes epic
export const getEpisodesEpic: Epic<PodcastsAction, State> = action$ =>
  action$
    .ofType(GET_EPISODES)
    .mergeMap((action: GetEpisodesAction) =>
      Podcasts
        .episodes(action.feed)
        .map(episodes => getEpisodesSuccess(action.feed, episodes))
    );

export const podcasts = (state: PodcastsState = {}, action: PodcastsAction): PodcastsState => {
  switch (action.type) {
    case GET_EPISODES:
      return {...state, [action.feed]: {
        ...state[action.feed],
        loading: true,
      }};
    case GET_EPISODES_SUCCESS:
      return {...state, [action.feed]: {
        ...state[action.feed],
        loading: false,
        episodes: action.episodes,
      }};
    default:
      return state;
  }
}
