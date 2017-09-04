/**
 * Player component
 */

import {
  h,
} from 'preact';

import {
  PlayerState,
} from '../stores/player';

interface PlayerProps extends PlayerState {
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
}

const Player = (_props: PlayerProps) => (
  <div />
);

export default Player;
