/**
 * Connected Podcasts Grid component
 */

import {
  connect,
} from 'preact-redux';

import {
  bindActionCreators,
  Dispatch,
} from 'redux';

import {
  State,
} from '../stores/root';

import {
  getFeed,
} from '../stores/feed';

import PodcastsGrid from '../components/PodcastsGrid';

const mapState = (state: State) => state.feed;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  getFeed,
}, dispatch);

const ConnectedPodcastsGrid = connect(
  mapState,
  mapDispatch,
)(PodcastsGrid);

export default ConnectedPodcastsGrid;
