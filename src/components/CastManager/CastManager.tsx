import React from 'react';
import AudioUtils from '../../shared/player/AudioUtils';

export const CastManager: React.FC = () => {
  React.useEffect(() => {
    document.addEventListener('cast-available', AudioUtils.onChromecastEnabled);
    return () => {
      document.removeEventListener('cast-available', AudioUtils.onChromecastEnabled);
    };
  }, []);
  return null;
};
