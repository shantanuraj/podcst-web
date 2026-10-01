import sanitizeHtml from 'sanitize-html';

const options: sanitizeHtml.IOptions = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'button', 'img'],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel'],
    button: ['data-timestamp', 'type'],
    img: ['src', 'alt', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function linkifyText(text: string | undefined): string {
  if (!text) return '';
  const marked = sanitizeHtml(text, {
    ...options,
    textFilter: (value, tag) => {
      if (['a', 'button', 'code', 'pre'].includes(tag)) return value;
      return value.replace(
        /https?:\/\/[^\s<>]+|\b(?:\d{1,2}:)?[0-5]?\d:[0-5]\d\b/gi,
        (token) => {
          if (/^https?:\/\//i.test(token)) {
            const url = token.endsWith('.') ? token.slice(0, -1) : token;
            return `<a href="${url}" target="_blank">${url}</a>${token.endsWith('.') ? '.' : ''}`;
          }
          return `<button type="button" data-timestamp="${token}">${token}</button>`;
        },
      );
    },
  });
  return sanitizeHtml(marked, options).trim();
}
