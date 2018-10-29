/**
 * Connected player component
 */

import { connect } from 'react-redux';

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

const UNUSED_NUMBER_VAR = -1;

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
  duration: UNUSED_NUMBER_VAR,
  seekPosition: UNUSED_NUMBER_VAR,
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
