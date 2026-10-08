'use client';

import { useTranslation } from '@/shared/i18n';
import {
  episodeShareUrl,
  podcastShareUrl,
  type ShareRequest,
  useShare,
} from '@/shared/share/useShare';
import { Button } from './Button';
import styles from './Button.module.css';

export function ShareButton({ request }: { request: ShareRequest }) {
  const { t } = useTranslation();
  const url = request.episode
    ? episodeShareUrl(request.episode)
    : podcastShareUrl(request.podcast);
  if (!url) return null;
  return (
    <Button
      type="button"
      className={styles.withIcon}
      aria-label={t('share.title')}
      title={t('share.title')}
      onClick={() => useShare.getState().open(request)}
    >
      <ShareIcon />
    </Button>
  );
}

export function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}
