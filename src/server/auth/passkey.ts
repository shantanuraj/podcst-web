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
const ORIGIN =
  process.env.WEBAUTHN_RP_ORIGIN ||
  process.env.WEBAUTHN_ORIGIN ||
  'http://localhost:3000';

type ChallengeType = 'registration' | 'authentication';

type Challenge = {
  visitorId: string;
  challenge: string;
  type: ChallengeType;
  userId?: string;
  expiresAt: Date;
};

const challenges = new Map<string, Challenge>();

function setChallenge(
  visitorId: string,
  challenge: string,
  type: ChallengeType,
  userId?: string,
): void {
  challenges.set(visitorId, {
    visitorId,
    challenge,
    type,
    userId,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
}

function popChallenge(
  visitorId: string,
  type: ChallengeType,
): Challenge | null {
  const data = challenges.get(visitorId);
  challenges.delete(visitorId);

  if (!data || data.type !== type || data.expiresAt < new Date()) {
    return null;
  }

  return data;
}

export async function getRegistrationOptions(
  userId: string,
  email: string,
  visitorId: string,
) {
  const existingPasskeys = await sql`
    SELECT credential_id FROM passkeys WHERE user_id = ${userId}
  `;

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new Uint8Array(
      new TextEncoder().encode(userId).buffer,
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

  setChallenge(visitorId, options.challenge, 'registration', userId);

  return { options };
}

export async function verifyRegistration(
  expectedUserId: string,
  visitorId: string,
  response: RegistrationResponseJSON,
) {
  const challenge = popChallenge(visitorId, 'registration');
  if (!challenge) {
    throw new Error('Challenge expired or not found');
  }

  if (challenge.userId !== expectedUserId) {
    throw new Error('Challenge does not match current user');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Registration verification failed');
  }

  const { credential } = verification.registrationInfo;

  await sql`
    INSERT INTO passkeys (id, user_id, credential_id, public_key, counter)
    VALUES (
      ${generateId()},
      ${challenge.userId},
      ${credential.id},
      ${Buffer.from(credential.publicKey)},
      ${credential.counter}
    )
  `;

  return { verified: true };
}

export async function checkUserPasskeys(
  email: string,
): Promise<{ exists: boolean; hasPasskey: boolean; userId?: string }> {
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!user) {
    return { exists: false, hasPasskey: false };
  }

  const passkeys = await sql`
    SELECT 1 FROM passkeys WHERE user_id = ${user.id} LIMIT 1
  `;

  return { exists: true, hasPasskey: passkeys.length > 0, userId: user.id };
}

export async function getDiscoverableAuthOptions(visitorId: string) {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: [],
    userVerification: 'preferred',
  });

  setChallenge(visitorId, options.challenge, 'authentication');

  return { options };
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

  setChallenge(visitorId, options.challenge, 'authentication', user.id);

  return { options, userId: user.id };
}

export async function verifyAuthentication(
  visitorId: string,
  response: AuthenticationResponseJSON,
  userId?: string,
) {
  const challenge = popChallenge(visitorId, 'authentication');
  if (!challenge) {
    throw new Error('Challenge expired or not found');
  }

  if (challenge.userId && userId && challenge.userId !== userId) {
    throw new Error('Challenge does not match requested user');
  }

  type Passkey = {
    id: string;
    user_id: string;
    credential_id: string;
    public_key: Uint8Array<ArrayBuffer>;
    counter: number;
  };

  let passkey: Passkey | null = null;
  const challengeUserId = challenge.userId ?? userId;
  let resolvedUserId = challengeUserId;

  if (challengeUserId) {
    const [row] = await sql`
      SELECT id, user_id, credential_id, public_key, counter
      FROM passkeys
      WHERE user_id = ${challengeUserId} AND credential_id = ${response.id}
    `;
    passkey = (row as Passkey) ?? null;
  } else {
    const [row] = await sql`
      SELECT id, user_id, credential_id, public_key, counter
      FROM passkeys
      WHERE credential_id = ${response.id}
    `;
    passkey = (row as Passkey) ?? null;
    if (passkey) {
      resolvedUserId = passkey.user_id;
    }
  }

  if (!passkey) {
    throw new Error('Passkey not found');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
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

  return { verified: true, userId: resolvedUserId };
}
