import * as React from 'react';
import styles from './ExternalLink.module.css';

function ExternalLink({
  className,
  ...props
}: React.HTMLProps<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className={
        className ? `${styles.externalLink} ${className}` : styles.externalLink
      }
      target="_blank"
      rel="noopener noreferrer"
    />
  );
}

const MemoizedExternalLink = React.memo(ExternalLink);

export { MemoizedExternalLink as ExternalLink };
