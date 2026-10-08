import type { NextRequest } from 'next/server';
import { getSession } from '@/server/auth/session';
import {
  getCurrentProgress,
  getEpisodeProgress,
  getPodcastProgress,
  getRecentProgress,
} from '@/server/progress';
import { progressState, stateChanges } from '@/server/state';
import { stateResponse } from '@/server/state/http';
import { StateError } from '@/server/state/protocol';
import { isCanonicalId } from '@/shared/canonical-id';
import { STATE_READ_LIMIT } from '@/shared/state-contract';

export async function GET(request: NextRequest) {
  return stateResponse(async () => {
    const session = await getSession();
    if (!session) throw new StateError('unauthenticated', 'Unauthorized');
    const params = request.nextUrl.searchParams;
    for (const key of params.keys()) {
      if (
        !['view', 'recent', 'episodeIds', 'podcastId'].includes(key) ||
        params.getAll(key).length !== 1
      )
        throw new StateError('invalid_request', 'Invalid progress query');
    }
    const state = params.get('view') === 'state';
    if (params.has('view') && !state)
      throw new StateError('invalid_request', 'Invalid progress view');
    const selected = ['recent', 'episodeIds', 'podcastId'].filter((key) =>
      params.has(key),
    );
    if (
      selected.length > 1 ||
      (state && (selected.length !== 1 || params.has('podcastId')))
    )
      throw new StateError('invalid_request', 'Invalid progress selection');
    if (params.has('recent')) {
      const raw = params.get('recent') ?? '';
      const limit = Number(raw);
      if (!/^[1-9]\d?$/.test(raw) || limit > 10)
        throw new StateError(
          'invalid_request',
          'recent must be an integer from 1 to 10',
        );
      return state
        ? progressState.recent(session.userId, limit)
        : getRecentProgress(session.userId, limit);
    }
    if (params.has('episodeIds')) {
      const ids = (params.get('episodeIds') ?? '').split(',');
      if (
        ids.length > STATE_READ_LIMIT ||
        new Set(ids).size !== ids.length ||
        !ids.every(isCanonicalId)
      )
        throw new StateError(
          'invalid_request',
          'episodeIds must be 1 to 200 canonical IDs',
        );
      return state
        ? progressState.read(session.userId, ids)
        : getEpisodeProgress(session.userId, ids);
    }
    if (params.has('podcastId')) {
      const id = params.get('podcastId');
      if (!isCanonicalId(id))
        throw new StateError(
          'invalid_request',
          'A valid podcast ID is required',
        );
      return getPodcastProgress(session.userId, id);
    }
    return getCurrentProgress(session.userId);
  });
}

export const PUT = (request: Request) => stateChanges.progress(request);
