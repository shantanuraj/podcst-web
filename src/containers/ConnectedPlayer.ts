/**
 * Connected player component
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
  manualSeekUpdate,
  pauseEpisode,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
} from '../stores/player';

import Player from '../components/Player';

const mapState = (state: State) => state.player;

const mapDispatch = (dispatch: Dispatch<State>) => bindActionCreators({
  onSeek: manualSeekUpdate,
  pause: pauseEpisode,
  resume: resumeEpisode,
  skipToPrev: skipToPrevEpisode,
  skipToNext: skipToNextEpisode,
}, dispatch);

const ConnectedPlayer = connect(
  mapState,
  mapDispatch,
)(Player);

export default ConnectedPlayer;
