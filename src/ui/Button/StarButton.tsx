'use client';

import { useTranslation } from '@/shared/i18n';
import { validEpisodeId } from '@/shared/stars/state';
import { useStars } from '@/shared/stars/useStars';
import type { IEpisodeInfo } from '@/types';
import { Icon } from '@/ui/icons/svg/Icon';

import { Button } from './Button';
import styles from './StarButton.module.css';

export function StarButton({
  episode,
  className = '',
  showLabel = false,
}: {
  episode: IEpisodeInfo;
  className?: string;
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const { contains, initialized, toggle } = useStars();
  const starred = contains(episode);
  const label = t(starred ? 'library.unstar' : 'library.star');

  return (
    <Button
      type="button"
      className={`${styles.button} ${showLabel ? '' : styles.icon} ${className}`}
      data-starred={starred}
      aria-pressed={starred}
      disabled={!initialized || !validEpisodeId(episode.id)}
      aria-label={`${label} ${episode.title}`}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(episode);
      }}
    >
      <Icon
        icon={starred ? 'star-filled' : 'star'}
        size={showLabel ? 16 : 20}
        aria-hidden="true"
      />
      {showLabel && label}
    </Button>
  );
}
