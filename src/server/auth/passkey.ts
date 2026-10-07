import { sql } from '../db';
import { challengeStore } from './backend';
import { acceptedOrigins } from './native-apps';
import { createPasskeyService } from './passkey-service';

const rpId = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin =
  process.env.WEBAUTHN_RP_ORIGIN ||
  process.env.WEBAUTHN_ORIGIN ||
  'http://localhost:3000';

export const {
  getRegistrationOptions,
  verifyRegistration,
  getDiscoverableAuthOptions,
  verifyAuthentication,
} = createPasskeyService(sql, challengeStore, {
  rpId,
  origins: acceptedOrigins(rpId, origin),
});
