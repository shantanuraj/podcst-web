/**
 * Connected SeekView component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import { manualSeekUpdate } from '../stores/player';

import SeekView from '../components/SeekView';

const mapState = ({ app: { theme }, player: { buffering, duration, seekPosition } }: IState) => ({
  buffering,
  duration,
  seekPosition,
  theme,
});

const mapDispatch = {
  onSeek: manualSeekUpdate,
};

const ConnectedSeekView = connect(mapState, mapDispatch)(SeekView);

export default ConnectedSeekView;
