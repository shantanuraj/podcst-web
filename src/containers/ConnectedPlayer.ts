/**
 * Connected player component
 */

import { connect } from 'preact-redux';

import { IState } from '../stores/root';

import {
  jumpSeek,
  manualSeekUpdate,
  pauseEpisode,
  resumeEpisode,
  skipToNextEpisode,
  skipToPrevEpisode,
  toggleLargeSeek,
} from '../stores/player';

import Player from '../components/Player';

const mapState = ({
  app: { theme },
  player: { buffering, currentEpisode, isLargeSeekVisible, queue, seekDelta, state },
}: IState) => ({
  buffering,
  currentEpisode,
  isLargeSeekVisible,
  queue,
  seekDelta,
  state,
  theme,
});

const mapDispatch = {
  onSeek: manualSeekUpdate,
  pause: pauseEpisode,
  resume: resumeEpisode,
  skipToPrev: skipToPrevEpisode,
  skipToNext: skipToNextEpisode,
  toggleLargeSeek,
  jumpSeek,
};

const ConnectedPlayer = connect(mapState, mapDispatch)(Player);

export default ConnectedPlayer;
