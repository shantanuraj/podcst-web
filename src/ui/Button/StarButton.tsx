'use client';

import { useTranslation } from '@/shared/i18n';
import { validEpisodeId } from '@/shared/stars/state';
import { useStars } from '@/shared/stars/useStars';
import type { IEpisodeInfo } from '@/types';
import { Icon } from '@/ui/icons/svg/Icon';

import styles from './StarButton.module.css';

export function StarButton({
  episode,
  className = '',
}: {
  episode: IEpisodeInfo;
  className?: string;
}) {
  const { t } = useTranslation();
  const { contains, initialized, toggle } = useStars();
  const starred = contains(episode);
  const label = t(starred ? 'library.unstar' : 'library.star');

  return (
    <button
      type="button"
      className={`${styles.button} ${className}`}
      data-starred={starred}
      disabled={!initialized || !validEpisodeId(episode.id)}
      aria-label={`${label} ${episode.title}`}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(episode);
      }}
    >
      <Icon icon={starred ? 'star-filled' : 'star'} size={20} />
    </button>
  );
}
