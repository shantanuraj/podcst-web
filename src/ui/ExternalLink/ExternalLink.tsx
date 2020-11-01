import * as React from 'react';

function ExternalLink(props: React.HTMLProps<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

const MemoizedExternalLink = React.memo(ExternalLink);

export { MemoizedExternalLink as ExternalLink };
