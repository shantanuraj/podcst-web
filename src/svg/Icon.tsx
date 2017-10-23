/**
 * SVG Icons
 */

import { h } from 'preact';

import { style } from 'typestyle';

import BackIcon from './BackIcon';
import DayIcon from './DayIcon';
import MenuIcon from './MenuIcon';
import NightIcon from './NightIcon';
import PauseIcon from './PauseIcon';
import PlayIcon from './PlayIcon';
import SeekBack10 from './SeekBack10';
import SeekForward10 from './SeekForward10';
import SettingsIcon from './SettingsIcon';

export type IconType =
  | 'play'
  | 'pause'
  | 'settings'
  | 'night'
  | 'day'
  | 'menu'
  | 'back'
  | 'seek-back-10'
  | 'seek-forward-10';

interface IconProps {
  icon: IconType;
  color: string;
  size?: number;
}

const getIcon = (icon: IconProps['icon']): JSX.Element => {
  if (icon === 'play') {
    return <PlayIcon />;
  } else if (icon === 'pause') {
    return <PauseIcon />;
  } else if (icon === 'settings') {
    return <SettingsIcon />;
  } else if (icon === 'night') {
    return <NightIcon />;
  } else if (icon === 'day') {
    return <DayIcon />;
  } else if (icon === 'menu') {
    return <MenuIcon />;
  } else if (icon === 'back') {
    return <BackIcon />;
  } else if (icon === 'seek-back-10') {
    return <SeekBack10 />;
  } else if (icon === 'seek-forward-10') {
    return <SeekForward10 />;
  }

  return <PlayIcon />;
};

const iconStyle = (fill: string, size: number = 36) =>
  style({
    fill,
    height: size,
    width: size,
    minHeight: size,
    minWidth: size,
  });

const Icon = ({ icon, color, size }: IconProps) => <div class={iconStyle(color, size)}>{getIcon(icon)}</div>;

export default Icon;
