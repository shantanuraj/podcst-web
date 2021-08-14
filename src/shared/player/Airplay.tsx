import { useEffect, useState } from 'react';

import { Icon } from '../../ui/icons/svg/Icon';
import AudioUtils from './AudioUtils';

export const Airplay = () => {
  const [isAirplayEnabled, setIsAirplayEnabled] = useState(AudioUtils.isAirplayEnabled);

  useEffect(() => {
    AudioUtils.addAirplayAvailabilityListener(setIsAirplayEnabled);
    return () => AudioUtils.removeAirplayAvailabilityListener();
  }, []);

  if (!isAirplayEnabled) return null;

  return (
    <button onClick={AudioUtils.showAirplaySelector}>
      <Icon icon="airplay" />
    </button>
  );
};
