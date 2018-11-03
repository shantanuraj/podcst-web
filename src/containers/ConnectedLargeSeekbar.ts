/**
 * Connected LargeSeekbar component
 */

import { connect } from 'react-redux';

import { IState } from '../stores/root';

import { jumpSeek, manualSeekUpdate } from '../stores/player';

import LargeSeekbar from '../components/LargeSeekbar';

const UNUSED_MODE_VAR = 'inline';

const mapState = ({ player: { buffering, duration, seekPosition }, app: { theme } }: IState) => ({
  buffering,
  duration,
  seekPosition,
  theme,
  mode: UNUSED_MODE_VAR,
});

const mapDispatch = {
  jumpSeek,
  onSeek: manualSeekUpdate,
};

const ConnectedLargeSeekbar = connect(
  mapState,
  mapDispatch,
)(LargeSeekbar);

export default ConnectedLargeSeekbar;
