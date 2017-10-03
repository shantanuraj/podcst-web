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
  pause: pauseEpisode,
  resume: resumeEpisode,
  skipToNext: skipToNextEpisode,
  skipToPrev: skipToPrevEpisode,
  onSeek: manualSeekUpdate,
}, dispatch);

const ConnectedPlayer = connect(
  mapState,
  mapDispatch,
)(Player);

export default ConnectedPlayer;
