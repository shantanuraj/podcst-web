import { useEffect, useRef } from 'react';
import { useAccountDetails, useSavePreferences } from '@/data/account';
import { defaultPreferences } from '@/shared/preferences';
import { usePlayer } from './usePlayer';

export function usePreferenceSync() {
  const { data } = useAccountDetails();
  const { mutate } = useSavePreferences();
  const latest = useRef(data);
  latest.current = data;
  const speed = data?.preferences?.speed;

  useEffect(() => {
    if (speed === undefined) return;
    const player = usePlayer.getState();
    if (player.savedRate === undefined && player.rate !== speed)
      player.setRate(speed);
  }, [speed]);

  useEffect(
    () =>
      usePlayer.subscribe(
        (state) => (state.savedRate === undefined ? state.rate : undefined),
        (rate) => {
          const details = latest.current;
          if (rate === undefined || !details) return;
          const preferences = details.preferences ?? defaultPreferences;
          if (details.preferences === null || preferences.speed !== rate)
            mutate({ ...preferences, speed: rate });
        },
      ),
    [mutate],
  );
}
