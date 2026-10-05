import { cache } from 'react';
import { translations } from '@/shared/i18n/server';
import { linkifyText } from '@/shared/link/linkify-text';
import type { IEpisodeInfo } from '@/types';

import styles from './EpisodeInfo.module.css';
import { ShowNotesHandler } from './ShowNotesHandler';

const linkifyNotes = cache((notes: string) => ({ __html: linkifyText(notes) }));

export async function ShowNotes({
  className = '',
  episode,
}: {
  className?: string;
  episode: IEpisodeInfo;
}) {
  const { t } = await translations();
  return (
    <section id="show-notes" className={`${styles.showNotes} ${className}`}>
      <h2 className={styles.eyebrowHeading}>{t('podcast.showNotes')}</h2>
      <div dangerouslySetInnerHTML={linkifyNotes(episode.showNotes)} />
      <ShowNotesHandler id="show-notes" episode={episode} />
    </section>
  );
}
