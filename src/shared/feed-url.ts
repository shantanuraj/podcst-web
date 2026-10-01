export function isFeedUrlInput(value: string): boolean {
  return /^(?:https?:|[a-z][a-z\d+.-]*:\/\/)/i.test(value.trim());
}

export function feedUrl(value: string): string {
  const trimmed = value.trim();
  const url = new URL(trimmed);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new TypeError('A valid HTTP(S) feed URL is required');
  }
  return trimmed;
}
