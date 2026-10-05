import { speeds } from '../../contracts/playback/rules.json';

export interface Preferences {
  speed: number;
  volumeBoost: boolean;
  trimSilence: boolean;
}

export const defaultPreferences: Preferences = {
  speed: speeds.default,
  volumeBoost: false,
  trimSilence: false,
};

export function parsePreferences(value: unknown): Preferences | null {
  const body = value as Partial<Preferences> | null;
  if (
    !body ||
    typeof body.speed !== 'number' ||
    !speeds.supported.includes(body.speed) ||
    typeof body.volumeBoost !== 'boolean' ||
    typeof body.trimSilence !== 'boolean'
  )
    return null;
  return {
    speed: body.speed,
    volumeBoost: body.volumeBoost,
    trimSilence: body.trimSilence,
  };
}
