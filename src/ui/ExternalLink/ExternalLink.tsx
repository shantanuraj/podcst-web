import * as React from 'react';
import styles from './ExternalLink.module.css';

function ExternalLink(props: React.HTMLProps<HTMLAnchorElement>) {
  return <a {...props} className={styles.externalLink} target="_blank" rel="noopener noreferrer" />;
}

const MemoizedExternalLink = React.memo(ExternalLink);

export { MemoizedExternalLink as ExternalLink };
