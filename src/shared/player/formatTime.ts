import type { TranslationKey } from '@/shared/i18n';

export const formatSecondsToTimestamp = (seconds: number): string => {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = Math.floor((seconds % 3600) % 60);

  const time = [hh, mm, ss]
    .map((t) => t.toString().padStart(2, '0'))
    .filter((t, i) => t !== '00' || i > 0)
    .join(':');
  return time;
};

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

export const formatDuration = (t: Translate, seconds: number): string => {
  const total = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours
    ? t('player.hours', { hours, minutes })
    : t('player.minutes', { minutes });
};

export { timestampSeconds as getSecondsFromTimestamp } from '@/shared/chapters';
