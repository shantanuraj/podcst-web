'use server';

import { cache } from 'react';
import { translations } from '@/shared/i18n/server';
import { linkifyText } from '@/shared/link/linkify-text';
import type { IEpisodeInfo } from '@/types';

import styles from './EpisodeInfo.module.css';
import { ShowNotesHandler } from './ShowNotesHandler';

interface IShowNotesProps {
  className?: string;
  episode: IEpisodeInfo;
}

const linkifyNotes = cache((notes: string) => {
  return { __html: linkifyText(notes) };
});

export const ShowNotes = async ({
  className = '',
  episode,
}: IShowNotesProps) => {
  const { t } = await translations();
  const showNotes = linkifyNotes(episode.showNotes);
  return (
    <div id="show-notes" className={`${styles.showNotes} ${className}`}>
      <h3>{t('podcast.showNotes')}</h3>
      <div dangerouslySetInnerHTML={showNotes} />
      <ShowNotesHandler id="show-notes" episode={episode} />
    </div>
  );
};
