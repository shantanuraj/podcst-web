/**
 * Player component
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  PlayerState,
} from '../stores/player';

import Icon from '../svg/Icon';

const player = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  backgroundColor: '#292929',
  position: 'fixed',
  bottom: 0,
  left: 0,
  height: '64px',
  width: '100%',
  zIndex: 500,
  paddingLeft: 16,
  fontSize: 20,
  color: 'white',
  boxShadow: `0px 4px 32px 4px rgba(0,0,0,0.75)`,
});

interface PlayerProps extends PlayerState {
  pause: () => void;
  resume: () => void;
  skipToNext: () => void;
  skipToPrev: () => void;
}

const Player = ({
  pause,
  resume,
  state,
}: PlayerProps) => {
  if (state === 'stopped') {
    return null;
  }

  return (
    <div class={player}>
      <Icon
        onClick={state === 'playing' ? pause : resume }
        icon={state === 'playing' ? 'pause' : 'play'}
      />
    </div>
  );
};

export default Player;
