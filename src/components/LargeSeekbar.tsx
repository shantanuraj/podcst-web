/**
 * Large Seekbar component
 */

import * as React from 'react';

import { media, style } from 'typestyle';

import { SeekDirection } from '../stores/player';

import { DESKTOP_PLAYER_HEIGHT, MAIN_ICON_RATIO, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

import Seekbar, { ISeekbarProps } from './Seekbar';

import SeekInfo from './SeekInfo';

import SeekButton from './SeekButton';

import { App } from '../typings';

const seekbar = (theme: App.ITheme) =>
  style(
    {
      position: 'relative',
      height: DESKTOP_PLAYER_HEIGHT,
      width: '100%',
      backgroundColor: theme.background,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
    },
    media(
      { maxWidth: 600 },
      {
        height: MOBILE_PLAYER_HEIGHT,
      },
    ),
  );

const playerControls = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  minHeight: 24,
  $nest: {
    '& > div': {
      maxWidth: '70%',
    },
  },
});

interface ILargeSeekbarProps extends ISeekbarProps {
  jumpSeek(direction: SeekDirection);
}

const LargeSeekbar = (props: ILargeSeekbarProps) => (
  <div id="large-seekbar" className={seekbar(props.theme)}>
    <div className={playerControls}>
      <SeekButton
        direction="seek-back"
        hideOnMobile={false}
        label="Seek Back 10 seconds"
        onClick={() => props.jumpSeek('seek-back')}
        sizeRatio={MAIN_ICON_RATIO}
        theme={props.theme}
      />
      <Seekbar {...props} />
      <SeekButton
        direction="seek-forward"
        hideOnMobile={false}
        label="Seek Forward 10 seconds"
        onClick={() => props.jumpSeek('seek-forward')}
        sizeRatio={MAIN_ICON_RATIO}
        theme={props.theme}
      />
    </div>
    <SeekInfo duration={props.duration} seekPosition={props.seekPosition} theme={props.theme} />
  </div>
);

export default LargeSeekbar;
