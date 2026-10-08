import schema from '../../../contracts/state/schema.json';

export type ProgressEvent =
  | 'checkpoint'
  | 'ended'
  | 'played'
  | 'unplayed'
  | 'replay';

export function progressIntent(event: ProgressEvent, positionSeconds: number) {
  if (
    !Number.isSafeInteger(positionSeconds) ||
    positionSeconds < schema.definitions.seconds.minimum ||
    positionSeconds > schema.definitions.seconds.maximum
  )
    throw new Error('Invalid source position');
  return {
    positionSeconds: event === 'unplayed' ? 0 : positionSeconds,
    completed:
      event === 'checkpoint' ? null : event === 'ended' || event === 'played',
  };
}
