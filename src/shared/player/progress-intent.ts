import schema from '../../../contracts/state/schema.json';

export type ProgressEvent =
  | 'checkpoint'
  | 'ended'
  | 'played'
  | 'unplayed'
  | 'replay';

export function progressIntent(
  event: ProgressEvent,
  positionSeconds: number,
  previousCompleted: boolean,
) {
  if (
    !Number.isSafeInteger(positionSeconds) ||
    positionSeconds < schema.definitions.seconds.minimum ||
    positionSeconds > schema.definitions.seconds.maximum
  )
    throw new Error('Invalid source position');
  return {
    positionSeconds: event === 'unplayed' ? 0 : positionSeconds,
    completed:
      event === 'ended' ||
      event === 'played' ||
      (event === 'checkpoint' && previousCompleted),
  };
}
