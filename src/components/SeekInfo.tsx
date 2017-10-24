/**
 * SeekInfo component
 */

import { h } from 'preact';

import { style } from 'typestyle';

import { formatTime } from '../utils';

const seekInfoContainer = (theme: App.ITheme) =>
  style({
    color: theme.subTitle,
    height: 12,
    fontSize: 12,
  });

interface ISeekInfoProps {
  seekPosition: number;
  duration: number;
  theme: App.ITheme;
}

const SeekInfo = ({ duration, seekPosition, theme }: ISeekInfoProps) => {
  const currentTime = formatTime(seekPosition);
  const totalTime = formatTime(duration);
  return (
    <div class={seekInfoContainer(theme)}>
      <span aria-label={`Current episode time: ${currentTime}`}>{currentTime}</span> /{' '}
      <span aria-label={`Total time: ${totalTime}`}>{totalTime}</span>
    </div>
  );
};

export default SeekInfo;
