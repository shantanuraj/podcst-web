import { isCanonicalId } from '@/shared/canonical-id';

export function validateCatalogue(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) validateCatalogue(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const key of ['podcastId', 'episodeId', 'itunes_id']) {
    if (
      record[key] !== undefined &&
      record[key] !== null &&
      !isCanonicalId(record[key])
    )
      throw new Error('Invalid catalogue identity');
  }
  if (
    record.id !== undefined &&
    ('feed' in record ||
      'file' in record ||
      'cover' in record ||
      'episodes' in record) &&
    !isCanonicalId(record.id)
  )
    throw new Error('Invalid catalogue identity');
  for (const [key, child] of Object.entries(record))
    if (key !== 'genre' && key !== 'category' && key !== 'categories')
      validateCatalogue(child);
}
