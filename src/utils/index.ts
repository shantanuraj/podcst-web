/**
 * Utility functions
 */

/**
 * Simple event value extractor callback
 * @param fn - Callback to execute with string value
 */
export const onEvent = (fn: (val: string) => void) => {
  return (event: Event) => {
    const target = event.target as HTMLInputElement;
    fn(target.value);
  };
};

const URL_REGEX = /^https?\:\//;

/**
 * Linkify text
 */
export const linkifyText = (text: string): string => {
  const tokens = text.split(/\s/);
  const linkifed = tokens.map((token, i) => {
    const hasSpace = i !== (tokens.length - 1);
    const maybeSpace = hasSpace ? ' ' : '';

    if (URL_REGEX.test(token)) {
      return `<a target="_blank" href="${token}">${token}</a><span>${maybeSpace}</span>`;
    } else {
      return token + maybeSpace;
    }
  });

  return linkifed.join('');
}
