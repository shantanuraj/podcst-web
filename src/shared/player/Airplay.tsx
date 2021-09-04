import { Icon } from '../../ui/icons/svg/Icon';
import AudioUtils from './AudioUtils';
import { getIsAirplayEnabled, usePlayer } from './usePlayer';

export const Airplay = () => {
  const isAirplayEnabled = usePlayer(getIsAirplayEnabled);

  if (!isAirplayEnabled) return null;

  return (
    <button onClick={AudioUtils.showAirplaySelector}>
      <Icon icon="airplay" />
    </button>
  );
};
