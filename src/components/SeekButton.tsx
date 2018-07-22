/**
 * Seek Button component
 */

import * as React from 'react';

import Icon from '../svg/Icon';

import { playerButton } from './PlayerInfo';

interface ISeekButtonProps {
  direction: 'seek-back' | 'seek-forward';
  hideOnMobile: boolean;
  label: string;
  theme: App.ITheme;
  sizeRatio: number;
  onClick: () => void;
}

const SeekButton = ({ direction, hideOnMobile, label, onClick, sizeRatio, theme }: ISeekButtonProps) => (
  <button
    data-hide-on-mobile={hideOnMobile}
    role="button"
    aria-label={label}
    className={playerButton(sizeRatio)}
    onClick={onClick}
  >
    <Icon color={theme.accent} icon={direction} size="100%" />
  </button>
);

export default SeekButton;
