/**
 * Connected Loader component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import { IFeedData } from '../stores/feed';

import Loader from '../components/Loader';

const mapState = (state: IState) => {
  const { app, feed, podcasts, search } = state;
  const { theme } = app;

  const defaultState = {
    loading: true,
    theme,
  };

  const loadingFeed = Object.keys(feed).find(key => (feed[key] as IFeedData).loading);
  if (loadingFeed) {
    return defaultState;
  }

  const loadingPodcast = Object.keys(podcasts).find(key => podcasts[key].loading);
  if (loadingPodcast) {
    return defaultState;
  }

  if (search.searching) {
    return defaultState;
  }

  return {
    ...defaultState,
    loading: false,
  };
};

const ConnectedLoader = connect(mapState)(Loader);

export default ConnectedLoader;
