/**
 * Seek Button component
 */

import { h } from 'preact';

import Icon from '../svg/Icon';

import { playerButton } from './PlayerInfo';

interface ISeekButtonProps {
  direction: 'seek-back' | 'seek-forward';
  label: string;
  theme: App.ITheme;
  size: number;
  onClick: () => void;
}

const SeekButton = ({ direction, label, onClick, size, theme }: ISeekButtonProps) => (
  <button data-hide-on-mobile="true" role="button" aria-label={label} class={playerButton(size)} onClick={onClick}>
    <Icon color={theme.accent} icon={direction} size={size} />
  </button>
);

export default SeekButton;
