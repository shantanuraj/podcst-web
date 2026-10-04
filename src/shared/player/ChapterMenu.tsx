import { useTranslation } from '@/shared/i18n';
import type { IEpisodeInfo } from '@/types';
import { Chapters } from '@/ui/EpisodeInfo/Chapters';
import { Icon } from '@/ui/icons/svg/Icon';
import styles from './ChapterMenu.module.css';

export function ChapterMenu({ episode }: { episode: IEpisodeInfo }) {
  const { t } = useTranslation();
  return (
    <details
      className={styles.menu}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }}
    >
      <summary aria-label={t('chapters.title')} title={t('chapters.title')}>
        <Icon icon="queue-list" size={20} />
      </summary>
      <div className={styles.panel}>
        <Chapters episode={episode} />
      </div>
    </details>
  );
}
