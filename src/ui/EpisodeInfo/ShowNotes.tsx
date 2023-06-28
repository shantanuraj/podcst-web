'use client';

import React from 'react';
import { linkifyText } from '../../shared/link/linkify-text';
import { IEpisodeInfo } from '../../types';

import styles from './EpisodeInfo.module.css';
import { ShowNotesHandler } from './ShowNotesHandler';

interface IShowNotesProps {
  className?: string;
  episode: IEpisodeInfo;
}

export const ShowNotes = ({ className = '', episode }: IShowNotesProps) => {
  const showNotes = React.useMemo(() => {
    return { __html: linkifyText(episode.showNotes) };
  }, [episode.showNotes]);
  return (
    <div id="show-notes" className={`${styles.showNotes} ${className}`}>
      <h3>Show Notes</h3>
      <div dangerouslySetInnerHTML={showNotes} />
      <ShowNotesHandler id="show-notes" episode={episode} />
    </div>
  );
};
