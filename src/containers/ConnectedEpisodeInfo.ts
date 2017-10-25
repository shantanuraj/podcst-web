/**
 * Connected Loader component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { getEpisodes } from '../stores/podcasts';

import { playEpisode } from '../stores/player';

import EpisodeInfo from '../components/EpisodeInfo';

const mapState = (state: IState) => ({
  info: state.podcasts,
  isPlayerVisible: state.player.state !== 'stopped',
  mode: state.app.mode,
  theme: state.app.theme,
  currentEpisode: state.player.queue[state.player.currentEpisode] || null,
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
