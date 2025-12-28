'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Props {
  podcastId: number;
}

export function EmptyEpisodesRefresh({ podcastId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch('/api/feed/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ podcastId }),
        });

        if (cancelled) return;

        if (res.ok) {
          router.refresh();
        } else {
          setStatus('error');
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
        }
      }
    }

    refresh();

    return () => {
      cancelled = true;
    };
  }, [podcastId, router]);

  if (status === 'error') {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-12)',
        color: 'var(--color-ink-secondary)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
      }}
    >
      Loading episodes...
    </div>
  );
}
