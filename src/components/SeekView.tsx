/**
 * Seek View component
 */

import * as React from 'react';

import { style } from 'typestyle';

import SeekInfo from './SeekInfo';

import Seekbar from './Seekbar';

const seekInfo = style({
  position: 'absolute',
  top: 4,
  right: 0,
  maxWidth: '100%',
  overflow: 'hidden',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  marginRight: 32,
  // Thanks Google Play Music!
  transition: `opacity .218s ease`,
});

interface ISeekViewProps {
  buffering: boolean;
  duration: number;
  seekPosition: number;
  theme: App.ITheme;
  onSeek: (seekPosition: number, duration: number) => void;
}

const SeekView = ({ buffering, duration, seekPosition, theme, onSeek }: ISeekViewProps) => (
  <div data-hide-on-mobile="true">
    <div data-display-on-hover="true" className={seekInfo}>
      <SeekInfo duration={duration} seekPosition={seekPosition} theme={theme} />
    </div>
    <Seekbar
      mode="absolute"
      buffering={buffering}
      onSeek={onSeek}
      duration={duration}
      seekPosition={seekPosition}
      theme={theme}
    />
  </div>
);

export default SeekView;
