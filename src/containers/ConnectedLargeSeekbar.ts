/**
 * Connected LargeSeekbar component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import { jumpSeek, manualSeekUpdate } from '../stores/player';

import LargeSeekbar from '../components/LargeSeekbar';

const mapState = ({ player: { buffering, duration, seekPosition }, app: { theme } }: IState) => ({
  buffering,
  duration,
  seekPosition,
  theme,
});

const mapDispatch = {
  jumpSeek,
  onSeek: manualSeekUpdate,
};

const ConnectedLargeSeekbar = connect(mapState, mapDispatch)(LargeSeekbar);

export default ConnectedLargeSeekbar;
