/**
 * SVG Icons
 */

import type * as React from 'react';

import AddToQueue from './AddToQueue';
import AirplayIcon from './AirplayIcon';
import BackIcon from './BackIcon';
import Caret from './Caret';
import ChromecastConnectedIcon from './ChromecastConnectedIcon';
import ChromecastIcon from './ChromecastIcon';
import DayIcon from './DayIcon';
import InfoIcon from './InfoIcon';
import MenuIcon from './MenuIcon';
import MuteIcon from './MuteIcon';
import NightIcon from './NightIcon';
import OpenInNew from './OpenInNew';
import PauseIcon from './PauseIcon';
import PlayIcon from './PlayIcon';
import QueueList from './QueueList';
import Search from './Search';
import SeekBack from './SeekBack10';
import SeekForward from './SeekForward10';
import SettingsIcon from './SettingsIcon';
import VolumeIcon from './VolumeIcon';

export type IconType =
  | 'airplay'
  | 'chromecast'
  | 'chromecast-connected'
  | 'external-link'
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
  | 'search'
  | 'queue'
  | 'queue-list'
  | 'caret'
  | 'volume';

interface IconProps extends React.SVGProps<SVGSVGElement> {
  icon: IconType;
  color?: string;
  size?: string | number;
}

const IconMap: Record<IconType, React.FC<React.SVGProps<SVGSVGElement>>> = {
  airplay: AirplayIcon,
  chromecast: ChromecastIcon,
  'chromecast-connected': ChromecastConnectedIcon,
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
  queue: AddToQueue,
  'queue-list': QueueList,
  search: Search,
  caret: Caret,
  'external-link': OpenInNew,
};

export const Icon = ({ icon, color, size = 36, ...props }: IconProps) => {
  const dimen = `${size}px`;

  const IconContent = IconMap[icon];
  if (!IconContent) throw new Error('Invalid icon see IconType');

  return <IconContent {...props} height={dimen} width={dimen} fill={color || undefined} />;
};
