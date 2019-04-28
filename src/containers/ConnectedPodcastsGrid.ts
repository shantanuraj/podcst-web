/**
 * Connected Podcasts Grid component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { getFeed } from '../stores/feed';

import PodcastsGrid from '../components/PodcastsGrid';

import { FeedType } from '../typings';

const mapState = ({ app: { mode }, feed: feedData }: IState, { feed }: { feed: FeedType }) => ({
  ...feedData[feed],
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
