import { expect, test } from 'bun:test';
import { parsePreferences } from '@/shared/preferences';
import { passkeyProvider } from './auth/passkey-providers';

test('preferences accept only contract speeds and boolean effects', () => {
  expect(
    parsePreferences({ speed: 1.5, volumeBoost: true, trimSilence: false }),
  ).toEqual({ speed: 1.5, volumeBoost: true, trimSilence: false });
  for (const body of [
    null,
    { speed: 1.3, volumeBoost: false, trimSilence: false },
    { speed: '1', volumeBoost: false, trimSilence: false },
    { speed: 1, volumeBoost: 'yes', trimSilence: false },
    { speed: 1, volumeBoost: false },
  ])
    expect(parsePreferences(body)).toBeNull();
  expect(
    parsePreferences({
      speed: 2,
      volumeBoost: false,
      trimSilence: true,
      extra: 1,
    }),
  ).toEqual({ speed: 2, volumeBoost: false, trimSilence: true });
});

test('passkey providers are named from known AAGUIDs only', () => {
  expect(passkeyProvider('FBFC3007-154E-4ECC-8C0B-6E020557D7BD')).toBe(
    'iCloud Keychain',
  );
  expect(passkeyProvider('00000000-0000-0000-0000-000000000000')).toBeNull();
  expect(passkeyProvider(null)).toBeNull();
});

test('account fixtures carry preferences the server would accept', () => {
  for (const name of [
    'account.details.json',
    'account-preferences.saved.json',
  ]) {
    const body = require(`../../contracts/fixtures/api/${name}`);
    const preferences = body.preferences ?? body;
    expect(parsePreferences(preferences)).toEqual(preferences);
  }
});
