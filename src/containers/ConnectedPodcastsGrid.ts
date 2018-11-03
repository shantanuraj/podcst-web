/**
 * Connected Podcasts Grid component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { getFeed } from '../stores/feed';

import PodcastsGrid from '../components/PodcastsGrid';

const mapState = ({ app: { mode }, feed }: IState) => ({
  ...feed,
  themeMode: mode,
});

const mapDispatch = {
  getFeed,
};

const ConnectedPodcastsGrid = connect(
  mapState,
  mapDispatch,
)(PodcastsGrid);

export default ConnectedPodcastsGrid;
