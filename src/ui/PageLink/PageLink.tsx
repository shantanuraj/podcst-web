'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { PodcastLoading, PodcastsLoading } from '@/ui/PageLoading/PageLoading';
import styles from './PageLink.module.css';

type Props = ComponentProps<typeof Link> & {
  loading: 'podcast' | 'podcasts';
};

export function PageLink({ children, loading, ...props }: Props) {
  return (
    <Link {...props}>
      {children}
      <PendingPage loading={loading} />
    </Link>
  );
}

function PendingPage({ loading }: Pick<Props, 'loading'>) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  const target = document.getElementById('page-loading');
  if (!target) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(event) => event.stopPropagation()}
    >
      {loading === 'podcast' ? <PodcastLoading /> : <PodcastsLoading />}
    </div>,
    target,
  );
}
