/**
 * Connected player component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

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
  // Don't pass seekPosition to player
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
    },
    dispatch,
  );

const ConnectedPlayer = connect(mapState, mapDispatch)(Player);

export default ConnectedPlayer;
