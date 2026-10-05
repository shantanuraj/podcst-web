'use client';

import { useTranslation } from '@/shared/i18n';
import { useToast } from '@/shared/toast/useToast';
import { Button } from './Button';
import styles from './Button.module.css';

export function ShareButton({
  title,
  text,
  path,
}: {
  title: string;
  text: string;
  path: string;
}) {
  const { t } = useTranslation();
  const share = async () => {
    const url = new URL(path, window.location.origin).href;
    if (navigator.canShare?.({ title, text, url })) {
      await navigator.share({ title, text, url }).catch(() => {});
      return;
    }
    await navigator.clipboard
      .writeText(url)
      .then(() => useToast.getState().showToast(t('podcast.linkCopied')))
      .catch(() => {});
  };
  return (
    <Button
      type="button"
      className={styles.withIcon}
      aria-label={t('podcast.share')}
      title={t('podcast.share')}
      onClick={share}
    >
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
    </Button>
  );
}
