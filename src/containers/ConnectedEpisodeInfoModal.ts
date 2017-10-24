/**
 * Connected EpisodeInfoModal component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { getEpisodes } from '../stores/podcasts';

import { playEpisode } from '../stores/player';

import EpisodeInfoModal from '../components/EpisodeInfoModal';

const mapState = (state: IState) => ({
  currentEpisode: state.player.queue[state.player.currentEpisode] || null,
  isVisible: true,
  info: state.podcasts,
  isPlayerVisible: state.player.state !== 'stopped',
  mode: state.app.mode,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      getEpisodes,
      playEpisode,
    },
    dispatch,
  );

const ConnectedEpisodeInfoModal = connect(mapState, mapDispatch)(EpisodeInfoModal);

export default ConnectedEpisodeInfoModal;
