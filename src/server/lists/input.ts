import type { ListBatch } from '@/shared/lists';

export const LIST_BATCH_LIMIT = 100;
export const LIST_BODY_LIMIT = 64 * 1024;
export const LIST_PAGE_LIMIT = 200;

export const isListId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);

export const isEpisodeId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export const isListSequence = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseListBatch(value: unknown): ListBatch | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isListId(value.clientId) ||
    !isListSequence(value.sequence) ||
    !Array.isArray(value.changes) ||
    value.changes.length < 1 ||
    value.changes.length > LIST_BATCH_LIMIT
  )
    return null;
  const changes: ListBatch['changes'] = [];
  for (const change of value.changes) {
    if (
      !isRecord(change) ||
      Object.keys(change).length !== 2 ||
      (change.op !== 'add' && change.op !== 'remove') ||
      !isEpisodeId(change.episodeId)
    )
      return null;
    changes.push({ op: change.op, episodeId: change.episodeId });
  }
  return {
    clientId: value.clientId.toLowerCase(),
    sequence: value.sequence,
    changes,
  };
}

export interface ListCursor {
  listId: string;
  addedAt: number;
  episodeId: number;
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function parseListCursor(
  value: string,
  listId: string,
): ListCursor | null {
  if (value.length > 512 || !/^[\w-]+$/.test(value)) return null;
  try {
    const cursor: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    if (
      !isRecord(cursor) ||
      Object.keys(cursor).length !== 3 ||
      cursor.listId !== listId ||
      !isEpisodeId(cursor.episodeId) ||
      typeof cursor.addedAt !== 'number' ||
      !Number.isSafeInteger(cursor.addedAt) ||
      !Number.isFinite(new Date(cursor.addedAt).getTime())
    )
      return null;
    return {
      listId,
      episodeId: cursor.episodeId,
      addedAt: cursor.addedAt,
    };
  } catch {
    return null;
  }
}
