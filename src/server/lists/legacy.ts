import { createHash } from 'node:crypto';

import type { LegacyListBatch } from '@/shared/lists';

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
