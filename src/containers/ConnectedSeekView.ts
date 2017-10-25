/**
 * Connected SeekView component
 */

import { connect } from 'preact-redux';

import { bindActionCreators, Dispatch } from 'redux';

import { IState } from '../stores/root';

import { manualSeekUpdate } from '../stores/player';

import SeekView from '../components/SeekView';

const mapState = (state: IState) => ({
  buffering: state.player.buffering,
  duration: state.player.duration,
  seekPosition: state.player.seekPosition,
  theme: state.app.theme,
});

const mapDispatch = (dispatch: Dispatch<IState>) =>
  bindActionCreators(
    {
      onSeek: manualSeekUpdate,
    },
    dispatch,
  );

const ConnectedSeekView = connect(mapState, mapDispatch)(SeekView);

export default ConnectedSeekView;
