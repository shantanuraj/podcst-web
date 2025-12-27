import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { sql } from '../db';
import { generateId } from './session';

const RP_NAME = 'Podcst';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

type Challenge = {
  visitorId: string;
  challenge: string;
  expiresAt: Date;
};

const challenges = new Map<string, Challenge>();

function setChallenge(visitorId: string, challenge: string): void {
  challenges.set(visitorId, {
    visitorId,
    challenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
}

function getChallenge(visitorId: string): string | null {
  const data = challenges.get(visitorId);
  if (!data || data.expiresAt < new Date()) {
    challenges.delete(visitorId);
    return null;
  }
  return data.challenge;
}

export async function getRegistrationOptions(email: string, visitorId: string) {
  let [user] = await sql`SELECT id FROM users WHERE email = ${email}`;

  if (!user) {
    const userId = generateId();
    [user] = await sql`
      INSERT INTO users (id, email) VALUES (${userId}, ${email})
      RETURNING id
    `;
  }

  const existingPasskeys = await sql`
    SELECT credential_id FROM passkeys WHERE user_id = ${user.id}
  `;

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new Uint8Array(
      new TextEncoder().encode(user.id).buffer,
    ) as Uint8Array<ArrayBuffer>,
    userName: email,
    attestationType: 'none',
    excludeCredentials: existingPasskeys.map((p) => ({
      id: p.credential_id,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  setChallenge(visitorId, options.challenge);

  return { options, userId: user.id };
}

export async function verifyRegistration(
  userId: string,
  visitorId: string,
  response: RegistrationResponseJSON,
) {
  const expectedChallenge = getChallenge(visitorId);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Registration verification failed');
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  await sql`
    INSERT INTO passkeys (id, user_id, credential_id, public_key, counter)
    VALUES (
      ${generateId()},
      ${userId},
      ${credential.id},
      ${Buffer.from(credential.publicKey)},
      ${credential.counter}
    )
  `;

  challenges.delete(visitorId);

  return { verified: true };
}

export async function getAuthenticationOptions(
  email: string,
  visitorId: string,
) {
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!user) {
    throw new Error('User not found');
  }

  const passkeys = await sql`
    SELECT credential_id FROM passkeys WHERE user_id = ${user.id}
  `;

  if (passkeys.length === 0) {
    throw new Error('No passkeys registered');
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: passkeys.map((p) => ({
      id: p.credential_id,
    })),
    userVerification: 'preferred',
  });

  setChallenge(visitorId, options.challenge);

  return { options, userId: user.id };
}

export async function verifyAuthentication(
  userId: string,
  visitorId: string,
  response: AuthenticationResponseJSON,
) {
  const expectedChallenge = getChallenge(visitorId);
  if (!expectedChallenge) {
    throw new Error('Challenge expired or not found');
  }

  const [passkey] = await sql`
    SELECT id, credential_id, public_key, counter
    FROM passkeys
    WHERE user_id = ${userId} AND credential_id = ${response.id}
  `;

  if (!passkey) {
    throw new Error('Passkey not found');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: passkey.credential_id,
      publicKey: passkey.public_key,
      counter: passkey.counter,
    },
  });

  if (!verification.verified) {
    throw new Error('Authentication verification failed');
  }

  await sql`
    UPDATE passkeys
    SET counter = ${verification.authenticationInfo.newCounter}
    WHERE id = ${passkey.id}
  `;

  challenges.delete(visitorId);

  return { verified: true, userId };
}
