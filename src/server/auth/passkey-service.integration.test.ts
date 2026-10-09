import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { Redis } from 'ioredis';
import postgres from 'postgres';
import { startPostgres } from '../../../scripts/lib/postgres-sandbox';
import { createSchemaFixture } from '../../../scripts/lib/schema-fixture';
import { createChallengeStore } from './challenges';
import { createPasskeyService } from './passkey-service';

const rpId = 'auth.example.invalid';
const origin = `https://${rpId}`;
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest();
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = keys.publicKey.export({ format: 'jwk' });
const credentialId = randomBytes(32);
const credentialKey = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  Buffer.from(jwk.x ?? '', 'base64url'),
  Buffer.from([0x22, 0x58, 0x20]),
  Buffer.from(jwk.y ?? '', 'base64url'),
]);
const clientData = (type: string, challenge: string, source = origin) =>
  Buffer.from(
    JSON.stringify({ type, challenge, origin: source, crossOrigin: false }),
  );
function registration(challenge: string): RegistrationResponseJSON {
  const authData = Buffer.concat([
    hash(rpId),
    Buffer.from([0x45, 0, 0, 0, 0]),
    Buffer.alloc(16),
    Buffer.from([0, 32]),
    credentialId,
    credentialKey,
  ]);
  const attestation = isoCBOR.encode(
    new Map<string, string | Uint8Array | Map<string, string>>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', new Uint8Array(authData)],
    ]),
  );
  return {
    id: credentialId.toString('base64url'),
    rawId: credentialId.toString('base64url'),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData('webauthn.create', challenge).toString(
        'base64url',
      ),
      attestationObject: Buffer.from(attestation).toString('base64url'),
    },
  };
}
function assertion(
  challenge: string,
  count = 1,
  source = origin,
  relyingParty = rpId,
): AuthenticationResponseJSON {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(count);
  const authData = Buffer.concat([
    hash(relyingParty),
    Buffer.from([5]),
    counter,
  ]);
  const data = clientData('webauthn.get', challenge, source);
  return {
    id: credentialId.toString('base64url'),
    rawId: credentialId.toString('base64url'),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: data.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: sign(
        'sha256',
        Buffer.concat([authData, hash(data)]),
        keys.privateKey,
      ).toString('base64url'),
    },
  };
}

describe.skipIf(!process.env.PG_BIN)(
  'signed synthetic passkeys on PostgreSQL',
  () => {
    let cluster: ReturnType<typeof startPostgres>;
    let sql: postgres.Sql;
    let service: ReturnType<typeof createPasskeyService>;
    const session = {
      id: 'session',
      userId: 'owner',
      email: 'owner@example.invalid',
    };
    beforeAll(async () => {
      cluster = startPostgres();
      sql = postgres({ ...cluster.options, max: 10 });
      await createSchemaFixture(sql);
      await sql`INSERT INTO users (id, email) VALUES (${session.userId}, ${session.email})`;
      await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${session.id}, ${session.userId}, now() + interval '1 day')`;
      const pending = new Map<string, string>();
      const challenges = createChallengeStore({
        set: async (key: string, value: string) => {
          pending.set(key, value);
          return 'OK';
        },
        getdel: async (key: string) => {
          const value = pending.get(key) ?? null;
          pending.delete(key);
          return value;
        },
      } as unknown as Redis);
      service = createPasskeyService(sql, () => challenges, {
        rpId,
        origins: [origin],
      });
    }, 30_000);
    afterAll(async () => {
      await sql?.end();
      await cluster?.stop();
    });

    test('registers an attested credential once for the authenticated account', async () => {
      const start = await service.getRegistrationOptions(session);
      const response = registration(start.options.challenge);
      expect(
        await service.verifyRegistration(session, start.flowId, response),
      ).toEqual({ verified: true });
      expect(
        await sql`SELECT id FROM passkeys WHERE user_id = 'owner'`,
      ).toHaveLength(1);
      await expect(
        service.verifyRegistration(session, start.flowId, response),
      ).rejects.toMatchObject({ status: 400 });
    });

    test('concurrent redemption creates one session without account discovery', async () => {
      const start = await service.getDiscoverableAuthOptions();
      expect(start.options.allowCredentials).toEqual([]);
      const response = assertion(start.options.challenge);
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          service.verifyAuthentication(start.flowId, response),
        ),
      );
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(await sql`SELECT id FROM sessions`).toHaveLength(2);
    });

    test('rejects wrong origin, RP and signatures without issuing sessions', async () => {
      for (const kind of ['origin', 'rp', 'signature']) {
        const start = await service.getDiscoverableAuthOptions();
        const response = assertion(
          start.options.challenge,
          2,
          kind === 'origin' ? 'https://wrong.invalid' : origin,
          kind === 'rp' ? 'wrong.invalid' : rpId,
        );
        if (kind === 'signature')
          response.response.signature = randomBytes(64).toString('base64url');
        await expect(
          service.verifyAuthentication(start.flowId, response),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          service.verifyAuthentication(
            start.flowId,
            assertion(start.options.challenge, 2),
          ),
        ).rejects.toMatchObject({ status: 400 });
      }
      expect(await sql`SELECT id FROM sessions`).toHaveLength(2);
    });

    test('serializes counter updates from independent valid challenges', async () => {
      const starts = await Promise.all([
        service.getDiscoverableAuthOptions(),
        service.getDiscoverableAuthOptions(),
      ]);
      const results = await Promise.allSettled(
        starts.map((start) =>
          service.verifyAuthentication(
            start.flowId,
            assertion(start.options.challenge, 2),
          ),
        ),
      );
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
    });

    test('rolls back counter advancement when session insertion fails', async () => {
      const start = await service.getDiscoverableAuthOptions();
      await sql.unsafe(`CREATE FUNCTION reject_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic'; END $$;
      CREATE TRIGGER reject_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION reject_session()`);
      try {
        await expect(
          service.verifyAuthentication(
            start.flowId,
            assertion(start.options.challenge, 3),
          ),
        ).rejects.toThrow();
        expect((await sql`SELECT counter FROM passkeys`)[0].counter).toBe(2);
      } finally {
        await sql.unsafe(
          'DROP TRIGGER reject_session ON sessions; DROP FUNCTION reject_session()',
        );
      }
    });

    test('accepted passkey and account fences reject otherwise-valid signed authentication', async () => {
      const [key] = await sql`SELECT id FROM passkeys WHERE user_id = 'owner'`;
      const start = await service.getDiscoverableAuthOptions();
      const registrationStart = await service.getRegistrationOptions(session);
      const before = await sql`SELECT id FROM sessions ORDER BY id`;
      const operationId = randomUUID();
      await sql`INSERT INTO account_erasure_intents (operation_id, action, account_id, credential_id, accepted_at, receipt_expires_at)
        VALUES (${operationId}, 'revoke_passkey', 'owner', ${key.id}, now(), now() + interval '7 days')`;
      try {
        await expect(
          service.verifyAuthentication(
            start.flowId,
            assertion(start.options.challenge, 3),
          ),
        ).rejects.toMatchObject({ status: 400 });
        await sql`INSERT INTO account_erasure_intents (operation_id, action, account_id, accepted_at, receipt_expires_at)
          VALUES (${randomUUID()}, 'erase_account', 'owner', now(), now() + interval '7 days')`;
        await expect(
          service.verifyRegistration(
            session,
            registrationStart.flowId,
            registration(registrationStart.options.challenge),
          ),
        ).rejects.toMatchObject({ status: 401 });
        expect(
          Array.from(await sql`SELECT id FROM sessions ORDER BY id`),
        ).toEqual(Array.from(before));
      } finally {
        await sql`DELETE FROM account_erasure_intents`;
      }
    });

    test('revoking the registration session refuses an in-flight valid attestation', async () => {
      const start = await service.getRegistrationOptions(session);
      await sql`DELETE FROM sessions WHERE id = ${session.id}`;
      await expect(
        service.verifyRegistration(
          session,
          start.flowId,
          registration(start.options.challenge),
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(await sql`SELECT id FROM passkeys`).toHaveLength(1);
    });
  },
);
