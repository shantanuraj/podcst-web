const URL_REGEX = /^https?:\//;
const TIME_REGEX = /(?:(?:([0-9]|0[0-9]|1[0-9]|2[0-3]):)?([0-5][0-9])):?([0-5][0-9])/;

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
    }
    if (TIME_REGEX.test(token)) {
      const timestamp = TIME_REGEX.exec(token)!
        .slice(1)
        .filter((t) => t)
        .join(':');
      return token.replace(
        timestamp,
        `<button data-timestamp="${timestamp}">${timestamp}</button>`,
      );
    } else {
      return token + maybeSpace;
    }
  });

  return linkifed.join('').trim();
};
