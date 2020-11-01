/**
 * SVG Icons
 */

import * as React from 'react';

import BackIcon from './BackIcon';
import DayIcon from './DayIcon';
import InfoIcon from './InfoIcon';
import MenuIcon from './MenuIcon';
import NightIcon from './NightIcon';
import PauseIcon from './PauseIcon';
import PlayIcon from './PlayIcon';
import SeekBack from './SeekBack';
import SeekForward from './SeekForward';
import SettingsIcon from './SettingsIcon';

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
  | 'info';

interface IconProps {
  icon: IconType;
  color?: string;
  size?: string | number;
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
  } else if (icon === 'seek-back') {
    return <SeekBack />;
  } else if (icon === 'seek-forward') {
    return <SeekForward />;
  } else if (icon === 'info') {
    return <InfoIcon />;
  }

  throw new Error('Invalid icon see IconType');
};

export const Icon = ({ icon, color, size = 36 }: IconProps) => (
  <React.Fragment>
    <div className="icon">{getIcon(icon)}</div>
    <style jsx>{`
      .icon {
        ${color ? `fill: ${color}` : ''}
        height: ${size}px;
        width: ${size}px;
        min-height: ${size}px;
        min-width: ${size}px;
      }
    `}</style>
  </React.Fragment>
);
