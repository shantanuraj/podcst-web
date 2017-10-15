/**
 * Connected Podcasts Grid component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { getFeed } from '../stores/feed';

import PodcastsGrid from '../components/PodcastsGrid';

const mapState = (state: IState) => state.feed;

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      getFeed,
    },
    dispatch,
  );

const ConnectedPodcastsGrid = connect(mapState, mapDispatch)(PodcastsGrid);

export default ConnectedPodcastsGrid;
