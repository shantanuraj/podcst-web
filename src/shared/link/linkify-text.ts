const URL_REGEX = /^https?:\//;

/**
 * Returns normalized link
 */
const getLink = (token: string, maybeSpace: string): string => {
  const trimmedToken = token.trim();
  const lastChar = trimmedToken[trimmedToken.length - 1];
  let normalizedToken = trimmedToken;
  let seperator = maybeSpace;
  if (lastChar === '.') {
    normalizedToken = trimmedToken.slice(0, -1);
    seperator = lastChar + maybeSpace;
  }
  return `
    <a target="_blank" rel="noopener noreferrer" href="${normalizedToken}">
      ${normalizedToken}
    </a>
    <span>${seperator}</span>
  `.trim();
};

/**
 * Linkify text
 */
export const linkifyText = (text: string | undefined): string => {
  if (!text) return '';
  const tokens = text.split(/\s/);
  const linkifed = tokens.map((token, i) => {
    const hasSpace = i !== tokens.length - 1;
    const maybeSpace = hasSpace ? ' ' : '';

    if (URL_REGEX.test(token)) {
      return getLink(token, maybeSpace);
    } else {
      return token + maybeSpace;
    }
  });

  return linkifed.join('').trim();
};
