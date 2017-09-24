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
  onClick?: (e?: Event) => void;
}

const noop = () => {};

const iconStyle = style({
  fill: '#82ffb5',
  height: '32px',
  width: '32px',
  marginLeft: '16px',
  marginRight: '16px',
});

const Icon = ({
  icon,
  onClick,
}: IconProps) => (
  <div
    class={iconStyle}
    onClick={onClick || noop}
  >
    { icon === 'play' ? <PlayIcon /> : <PauseIcon /> }
  </div>
);

export default Icon;
