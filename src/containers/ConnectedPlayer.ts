/**
 * Connected player component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { showModal } from '../stores/app';

import {
  jumpSeek,
  manualSeekUpdate,
  pauseEpisode,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
} from '../stores/player';

import Player from '../components/Player';

const mapState = (state: IState) => ({
  ...state.player,
  mode: state.app.mode,
  theme: state.app.theme,
  // Don't pass seekPosition & duration to player
  duration: undefined,
  seekPosition: undefined,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      onSeek: manualSeekUpdate,
      pause: pauseEpisode,
      resume: resumeEpisode,
      skipToPrev: skipToPrevEpisode,
      skipToNext: skipToNextEpisode,
      jumpSeek,
      showModal,
    },
    dispatch,
  );

const ConnectedPlayer = connect(mapState, mapDispatch)(Player);

export default ConnectedPlayer;
