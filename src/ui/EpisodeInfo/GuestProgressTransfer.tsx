'use client';

import { useState } from 'react';
import { useDurableState } from '@/data/state-browser';
import { useSession } from '@/shared/auth/useAuth';

export function GuestProgressTransfer({ episodeId }: { episodeId?: string }) {
  const { data: user } = useSession();
  const durable = useDurableState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const entries = durable.guestProgress.filter(
    (item) => episodeId === undefined || item.episodeId === episodeId,
  );
  if (!user || (!entries.length && !error)) return null;
  return (
    <section aria-label="Guest listening positions">
      {entries.map((selection) => (
        <div key={selection.episodeId}>
          <span>
            Guest episode {selection.episodeId}: {selection.positionSeconds}{' '}
            seconds · {selection.completed ? 'Played' : 'Unplayed'}
          </span>{' '}
          <button
            type="button"
            disabled={busy || !durable.canTransferGuestProgress}
            onClick={async () => {
              setBusy(true);
              setError(false);
              try {
                await durable.transferGuestProgress(selection);
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            Use this position for this account
          </button>
        </div>
      ))}
      {error && (
        <p role="alert">
          Position not transferred. Check this account and select the current
          guest position again.
        </p>
      )}
    </section>
  );
}
