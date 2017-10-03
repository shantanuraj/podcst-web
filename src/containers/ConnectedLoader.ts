/**
 * Connected Loader component
 */

import {
  connect,
} from 'preact-redux';

import {
  State,
} from '../stores/root';

import {
  FeedData,
} from '../stores/feed';

import Loader from '../components/Loader';

const mapState = (state: State) => {
  const {
    feed,
    podcasts,
    search,
  } = state;

  const stateLoading = {
    loading: true,
  };

  const loadingFeed = Object.keys(feed)
    .find((key) => (feed[key] as FeedData).loading);
  if (loadingFeed) {
    return stateLoading;
  }

  const loadingPodcast = Object.keys(podcasts)
    .find((key) => podcasts[key].loading);
  if (loadingPodcast) {
    return stateLoading;
  }

  if (search.searching) {
    return stateLoading;
  }

  return {
    loading: false,
  };
};

const ConnectedLoader = connect(
  mapState,
)(Loader);

export default ConnectedLoader;
