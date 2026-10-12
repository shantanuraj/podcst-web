export const BATCH_ABORT_MIN_ATTEMPTS = 50;

export function shouldAbortPollBatch(
  attempts: number,
  transientFailures: number,
) {
  return (
    attempts >= BATCH_ABORT_MIN_ATTEMPTS && transientFailures * 2 > attempts
  );
}
