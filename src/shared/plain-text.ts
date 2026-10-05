const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const plainText = (html: string | null | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] !== '#') return entities[code.toLowerCase()] ?? match;
      const point = Number.parseInt(
        code.slice(code[1].toLowerCase() === 'x' ? 2 : 1),
        code[1].toLowerCase() === 'x' ? 16 : 10,
      );
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
