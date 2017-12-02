/**
 * Connected Loader component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { getEpisodes } from '../stores/podcasts';

import { playEpisode } from '../stores/player';

import EpisodeInfo from '../components/EpisodeInfo';

const mapState = ({ app: { mode, theme }, player: { currentEpisode, queue }, podcasts }: IState) => ({
  info: podcasts,
  mode,
  theme,
  currentEpisode: queue[currentEpisode] || null,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      getEpisodes,
      playEpisode,
    },
    dispatch,
  );

const ConnectedEpisodeInfo = connect(mapState, mapDispatch)(EpisodeInfo);

export default ConnectedEpisodeInfo;
