const STYLE_ATTR_REGEX = /style="[^"]*"/g;

export const reformatShowNotes = (notes: string) =>
  notes.replace(STYLE_ATTR_REGEX, '');

export const showNotesSorter = (a: string, b: string) => a.length - b.length;
