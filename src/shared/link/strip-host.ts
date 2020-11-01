const HOST_REGEX = /^https?:\/\/(www\.)?(.*)/;

/**
 * Strip host from link
 */
export const stripHost = (link: string): string => {
  const matches = link.match(HOST_REGEX) as RegExpMatchArray;
  if (matches && matches[2]) {
    return matches[2].split('/')[0];
  }
  return link.split('/')[0];
};
