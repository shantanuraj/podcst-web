import { createHash } from 'node:crypto';

export interface LegacyListBatch {
  clientId: string;
  sequence: string;
  changes: { op: 'add' | 'remove'; episodeId: number }[];
}

export function legacyListHash(listId: string, batch: LegacyListBatch) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        listId,
        clientId: batch.clientId,
        sequence: batch.sequence,
        changes: batch.changes.map(({ op, episodeId }) => ({ op, episodeId })),
      }),
    )
    .digest('hex');
}
