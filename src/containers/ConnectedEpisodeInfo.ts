/**
 * Connected Loader component
 */

import {
  connect,
} from 'preact-redux';

import {
  bindActionCreators,
  Dispatch,
} from 'redux';

import {
  IState,
} from '../stores/root';

import {
  getEpisodes,
} from '../stores/podcasts';

import {
  pauseEpisode,
  playEpisode,
  resumeEpisode,
} from '../stores/player';

import EpisodeInfo from '../components/EpisodeInfo';

const mapState = (state: IState) => ({
  info: state.podcasts,
  theme: state.app.theme,
  state: state.player.state,
});

const mapDispatch = (dispatch: Dispatch<IState>) => bindActionCreators({
  getEpisodes,
  playEpisode,
  pauseEpisode,
  resumeEpisode,
}, dispatch);

const ConnectedEpisodeInfo = connect(
  mapState,
  mapDispatch,
)(EpisodeInfo);

export default ConnectedEpisodeInfo;
