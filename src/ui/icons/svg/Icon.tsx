/**
 * SVG Icons
 */

import * as React from 'react';

import BackIcon from './BackIcon';
import DayIcon from './DayIcon';
import InfoIcon from './InfoIcon';
import MenuIcon from './MenuIcon';
import MuteIcon from './MuteIcon';
import NightIcon from './NightIcon';
import PauseIcon from './PauseIcon';
import PlayIcon from './PlayIcon';
import SeekBack from './SeekBack10';
import SeekForward from './SeekForward10';
import SettingsIcon from './SettingsIcon';
import VolumeIcon from './VolumeIcon';

export type IconType =
  | 'play'
  | 'pause'
  | 'settings'
  | 'night'
  | 'day'
  | 'menu'
  | 'back'
  | 'seek-back'
  | 'seek-forward'
  | 'info'
  | 'mute'
  | 'volume';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  icon: IconType;
  color?: string;
  size?: string | number;
}

const IconMap: Record<IconType, React.FC<React.SVGProps<SVGSVGElement>>> = {
  play: PlayIcon,
  pause: PauseIcon,
  settings: SettingsIcon,
  night: NightIcon,
  day: DayIcon,
  menu: MenuIcon,
  back: BackIcon,
  'seek-back': SeekBack,
  'seek-forward': SeekForward,
  info: InfoIcon,
  mute: MuteIcon,
  volume: VolumeIcon,
};

export const Icon = ({ icon, color, size = 36, ...props }: IconProps) => {
  const dimen = `${size}px`;

  const IconContent = IconMap[icon];
  if (!IconContent) throw new Error('Invalid icon see IconType');

  return <IconContent {...props} height={dimen} width={dimen} fill={color || undefined} />;
};
