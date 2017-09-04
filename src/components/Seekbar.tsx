/**
 * Seekbar component
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import {
  formatTime,
} from '../utils';

const seekbarContainer = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexGrow: 1,
  height: '100%',
});

const seekbar = (duration: number, seekPosition: number) => style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '50%',
  height: `${Math.floor(seekPosition / duration) * 100}%`,
  backgroundColor: `rgba(0, 0, 0, 0.5)`,
});

interface SeekbarProps {
  duration: number;
  seekPosition: number;
}

const Seekbar = ({
  duration,
  seekPosition,
}: SeekbarProps) => (
  <div class={seekbarContainer}>
    {formatTime(duration, seekPosition)}
    <div class={seekbar(duration, seekPosition)}/>
  </div>
);

export default Seekbar;
