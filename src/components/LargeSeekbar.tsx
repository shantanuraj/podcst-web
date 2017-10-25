/**
 * Large Seekbar component
 */

import { h } from 'preact';

import { media, style } from 'typestyle';

import Seekbar, { ISeekbarProps } from './Seekbar';

import SeekInfo from './SeekInfo';

import SeekButton from './SeekButton';

import { DESKTOP_PLAYER_HEIGHT, MOBILE_PLAYER_HEIGHT } from '../utils/constants';

const MAIN_ICON_RATIO = 2 / 3;

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

/* tslint:disable:no-console */

const LargeSeekbar = (props: ISeekbarProps) => (
  <div id="large-seekbar" class={seekbar(props.theme)}>
    <div class={playerControls}>
      <SeekButton
        direction="seek-back"
        hideOnMobile={false}
        label="Seek Back 10 seconds"
        onClick={() => console.log('seek-back')}
        sizeRatio={MAIN_ICON_RATIO}
        theme={props.theme}
      />
      <Seekbar {...props} />
      <SeekButton
        direction="seek-forward"
        hideOnMobile={false}
        label="Seek Forward 10 seconds"
        onClick={() => console.log('seek-forward')}
        sizeRatio={MAIN_ICON_RATIO}
        theme={props.theme}
      />
    </div>
    <SeekInfo duration={props.duration} seekPosition={props.seekPosition} theme={props.theme} />
  </div>
);

export default LargeSeekbar;
