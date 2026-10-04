'use client';

import type { CSSProperties } from 'react';
import { useArtworkTint } from '@/shared/artwork/useArtworkTint';

import styles from './ArtworkBackdrop.module.css';

type ArtworkBackdropProps = {
  src?: string;
  privateSource?: boolean;
};

export function ArtworkBackdrop({ src, privateSource }: ArtworkBackdropProps) {
  const tint = useArtworkTint(src, privateSource);
  if (!tint) return null;
  return (
    <div
      key={`${tint.light}${tint.dark}`}
      aria-hidden
      className={styles.backdrop}
      style={
        {
          '--tint-light': tint.light,
          '--tint-dark': tint.dark,
        } as CSSProperties
      }
    />
  );
}
