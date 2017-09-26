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
  onClick?: (e?: Event) => void;
}

const noop = () => {};

const iconStyle = (theme: App.Theme) => style({
  fill: theme.accent,
  height: '32px',
  width: '32px',
  marginLeft: '16px',
  marginRight: '16px',
});

const Icon = ({
  icon,
  onClick,
  theme,
}: IconProps) => (
  <div
    class={iconStyle(theme)}
    onClick={onClick || noop}
  >
    { icon === 'play' ? <PlayIcon /> : <PauseIcon /> }
  </div>
);

export default Icon;
