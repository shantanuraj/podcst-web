import type { ProgressOutbox } from '@/data/progress-outbox';

export function progressSyncStatus(
  progress: ProgressOutbox | undefined,
  episodeId: string | undefined,
  error?: string,
) {
  if (!episodeId) return undefined;
  if (error || progress?.blocked) return error ?? progress?.blocked;
  if (progress?.failures.includes(episodeId))
    return 'Listening progress could not be saved because this episode is unavailable.';
  if (
    progress?.flight?.batch.changes.some(
      (change) => change.episodeId === episodeId,
    ) ||
    progress?.queued.some((change) => change.episodeId === episodeId)
  )
    return 'Saved on this device. Waiting to sync…';
  return undefined;
}
