/**
 * SVG Icons
 */

import {
  h,
} from 'preact';

import {
  style,
} from 'typestyle';

import PlayIcon from './PlayIcon';
import PauseIcon from './PauseIcon';

interface IconProps {
  icon: 'play' | 'pause';
  theme: App.Theme;
}

const iconStyle = (theme: App.Theme) => style({
  fill: theme.accent,
  height: '36px',
  width: '36px',
});

const Icon = ({
  icon,
  theme,
}: IconProps) => (
  <div
    class={iconStyle(theme)}
  >
    { icon === 'play' ? <PlayIcon /> : <PauseIcon /> }
  </div>
);

export default Icon;
