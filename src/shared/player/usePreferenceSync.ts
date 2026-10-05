import { useEffect, useRef } from 'react';
import { useAccountDetails, useSavePreferences } from '@/data/account';
import { usePlayer } from './usePlayer';

export function usePreferenceSync() {
  const { data } = useAccountDetails();
  const save = useSavePreferences();
  const preferences = data?.preferences;
  const latest = useRef(preferences);
  latest.current = preferences;
  const { mutate } = save;

  useEffect(() => {
    if (!preferences) return;
    const player = usePlayer.getState();
    if (player.savedRate === undefined && player.rate !== preferences.speed)
      player.setRate(preferences.speed);
  }, [preferences]);

  useEffect(
    () =>
      usePlayer.subscribe(
        (state) => (state.savedRate === undefined ? state.rate : undefined),
        (rate) => {
          const current = latest.current;
          if (rate !== undefined && current && current.speed !== rate)
            mutate({ ...current, speed: rate });
        },
      ),
    [mutate],
  );
}
