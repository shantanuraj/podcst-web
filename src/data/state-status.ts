import type { ProgressOutbox } from '@/data/progress-outbox';

export function blockedSyncStatus(
  resource: 'progress' | 'follows',
  reason: string | undefined,
) {
  if (!reason) return undefined;
  return resource === 'progress'
    ? 'Listening progress syncing is paused.'
    : 'Subscription syncing is paused.';
}

export function progressSyncStatus(
  progress: ProgressOutbox | undefined,
  episodeId: string | undefined,
  error?: string,
) {
  if (!episodeId) return undefined;
  if (error || progress?.blocked)
    return error ?? blockedSyncStatus('progress', progress?.blocked);
  if (progress?.failures.includes(episodeId))
    return 'Listening progress could not be saved because this episode is unavailable.';
  return undefined;
}
