'use client';

import { useEffect, useState } from 'react';
import { artworkTintSource } from '@/shared/artwork';
import { type ArtworkTint, ArtworkTintCache } from './tint';

export type { ArtworkTint } from './tint';

const cache = new ArtworkTintCache();

export function useArtworkTint(src?: string, privateSource = false) {
  const source = artworkTintSource(src, privateSource);
  const [result, setResult] = useState<{
    source: string;
    tint: ArtworkTint | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (source) {
      void cache.get(source).then((tint) => {
        if (active) setResult({ source, tint });
      });
    }
    return () => {
      active = false;
    };
  }, [source]);

  return source && result?.source === source ? result.tint : null;
}
