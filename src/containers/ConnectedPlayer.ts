/**
 * Connected player component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { manualSeekUpdate, pauseEpisode, resumeEpisode, skipToNextEpisode, skipToPrevEpisode } from '../stores/player';

import Player from '../components/Player';

const mapState = (state: IState) => state.player;

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      onSeek: manualSeekUpdate,
      pause: pauseEpisode,
      resume: resumeEpisode,
      skipToPrev: skipToPrevEpisode,
      skipToNext: skipToNextEpisode,
    },
    dispatch,
  );

const ConnectedPlayer = connect(mapState, mapDispatch)(Player);

export default ConnectedPlayer;
