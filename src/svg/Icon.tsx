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
  theme: App.Theme;
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
    {getIcon(icon)}
  </div>
);

export default Icon;
