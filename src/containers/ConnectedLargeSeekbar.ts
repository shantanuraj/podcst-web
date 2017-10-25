/**
 * Connected LargeSeekbar component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { jumpSeek, manualSeekUpdate } from '../stores/player';

import LargeSeekbar from '../components/LargeSeekbar';

const mapState = (state: IState) => ({
  buffering: state.player.buffering,
  duration: state.player.duration,
  seekPosition: state.player.seekPosition,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      jumpSeek,
      onSeek: manualSeekUpdate,
    },
    dispatch,
  );

const ConnectedLargeSeekbar = connect(mapState, mapDispatch)(LargeSeekbar);

export default ConnectedLargeSeekbar;
