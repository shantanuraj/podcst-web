/**
 * Connected Loader component
 */

import { connect } from 'react-redux';

import { RouteComponentProps } from 'react-router';

import { IState } from '../stores/root';

import { getEpisodes } from '../stores/podcasts';

import { playEpisode } from '../stores/player';

import EpisodeInfo from '../components/EpisodeInfo';

const mapState = (
  { app: { mode, theme }, player: { currentEpisode, queue }, podcasts }: IState,
  ownProps: RouteComponentProps<any>,
) => ({
  info: podcasts,
  mode,
  theme,
  currentEpisode: queue[currentEpisode] || null,
  ...ownProps,
});

const mapDispatch = {
  getEpisodes,
  playEpisode,
};

const ConnectedEpisodeInfo = connect(mapState, mapDispatch)(EpisodeInfo);

export default ConnectedEpisodeInfo;
