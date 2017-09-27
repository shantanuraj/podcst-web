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
import SettingsIcon from './SettingsIcon';

interface IconProps {
  icon: 'play' | 'pause' | 'settings';
  color: string;
}

const getIcon = (icon: IconProps['icon']): JSX.Element => {
  if (icon === 'play') {
    return <PlayIcon />
  } else if (icon === 'pause') {
    return <PauseIcon />
  } else if (icon === 'settings') {
    return <SettingsIcon />
  }

  return <PlayIcon />
}

const iconStyle = (fill) => style({
  fill,
  height: '36px',
  width: '36px',
});

const Icon = ({
  icon,
  color,
}: IconProps) => (
  <div
    class={iconStyle(color)}
  >
    {getIcon(icon)}
  </div>
);

export default Icon;
