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

const seekbar = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '50%',
  height: '100%',
  backgroundColor: `rgba(0, 0, 0, 0.75)`,
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
    <div class={seekbar}/>
  </div>
);

export default Seekbar;
