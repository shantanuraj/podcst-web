import { linkifyText } from '../../shared/link/linkify-text';

import styles from './EpisodeInfo.module.css';

interface IShowNotesProps {
  className?: string;
  showNotes: string;
}

export const ShowNotes = ({ className = '', showNotes }: IShowNotesProps) => (
  <div className={`${styles.showNotes} ${className}`}>
    <h3>Show Notes</h3>
    <div dangerouslySetInnerHTML={{ __html: linkifyText(showNotes) }} />
  </div>
);
