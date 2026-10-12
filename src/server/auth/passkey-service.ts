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
import type postgres from 'postgres';
import type { createChallengeStore } from './challenges';
import { AuthError } from './error';
import { generateId, insertSession } from './session-record';

type Session = { userId: string; id: string; email: string };

export function createPasskeyService(
  sql: postgres.Sql,
  challengeStore: () => ReturnType<typeof createChallengeStore>,
  { rpId: RP_ID, origins: ORIGINS }: { rpId: string; origins: string[] },
) {
  async function getRegistrationOptions(session: Session) {
    const passkeys =
      await sql`SELECT credential_id FROM passkeys WHERE user_id = ${session.userId}`;
    const options = await generateRegistrationOptions({
      rpName: 'Podcst',
      rpID: RP_ID,
      userID: new TextEncoder().encode(session.userId),
      userName: session.email,
      attestationType: 'none',
      excludeCredentials: passkeys.map((p) => ({ id: p.credential_id })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });
    const flowId = await challengeStore().issue({
      purpose: 'registration',
      challenge: options.challenge,
      userId: session.userId,
      sessionId: session.id,
    });
    return { options, flowId };
  }

  async function verifyRegistration(
    session: Session,
    flowId: string,
    response: RegistrationResponseJSON,
  ) {
    const challenge = await challengeStore().consume(flowId, {
      purpose: 'registration',
      userId: session.userId,
      sessionId: session.id,
    });
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
    }).catch(() => {
      throw new AuthError(400, 'Passkey verification failed');
    });
    if (!verification.verified || !verification.registrationInfo)
      throw new AuthError(400, 'Passkey verification failed');
    const { credential, aaguid } = verification.registrationInfo;
    await sql.begin(async (tx) => {
      const [active] =
        await tx`SELECT user_id FROM sessions WHERE id = ${session.id} AND user_id = ${session.userId} AND expires_at > clock_timestamp() FOR UPDATE`;
      if (!active) throw new AuthError(401, 'Authentication required');
      await tx`INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, aaguid)
      VALUES (${generateId()}, ${session.userId}, ${credential.id}, ${Buffer.from(credential.publicKey)}, ${credential.counter}, ${aaguid})`;
    });
    return { verified: true };
  }

  async function getDiscoverableAuthOptions() {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: [],
      userVerification: 'required',
    });
    const flowId = await challengeStore().issue({
      purpose: 'authentication',
      challenge: options.challenge,
    });
    return { options, flowId };
  }

  async function verifyAuthentication(
    flowId: string,
    response: AuthenticationResponseJSON,
  ) {
    const challenge = await challengeStore().consume(flowId, {
      purpose: 'authentication',
    });
    if (typeof response.id !== 'string' || response.id.length > 2048)
      throw new AuthError(400, 'Passkey verification failed');
    return sql.begin(async (tx) => {
      const [passkey] =
        await tx`SELECT id, user_id, credential_id, public_key, counter FROM passkeys WHERE credential_id = ${response.id} FOR UPDATE`;
      if (!passkey) throw new AuthError(400, 'Passkey verification failed');
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: ORIGINS,
        expectedRPID: RP_ID,
        credential: {
          id: passkey.credential_id,
          publicKey: passkey.public_key,
          counter: passkey.counter,
        },
      }).catch(() => {
        throw new AuthError(400, 'Passkey verification failed');
      });
      if (!verification.verified)
        throw new AuthError(400, 'Passkey verification failed');
      await tx`UPDATE passkeys SET counter = ${verification.authenticationInfo.newCounter}, last_used_at = now() WHERE id = ${passkey.id}`;
      return {
        session: await insertSession(tx, passkey.user_id),
        userId: passkey.user_id as string,
      };
    });
  }
  return {
    getRegistrationOptions,
    verifyRegistration,
    getDiscoverableAuthOptions,
    verifyAuthentication,
  };
}
