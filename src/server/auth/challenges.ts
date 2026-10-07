import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AuthError } from './error';

type Binding =
  | { purpose: 'registration'; userId: string; sessionId: string }
  | { purpose: 'authentication' };
type Challenge = Binding & { challenge: string };
const invalid = () => new AuthError(400, 'Invalid or expired passkey flow');

export function createChallengeStore(redis: Pick<Redis, 'set' | 'getdel'>) {
  return {
    async issue(challenge: Challenge) {
      const flowId = randomBytes(32).toString('base64url');
      const value = JSON.stringify(challenge);
      if (Buffer.byteLength(value) > 4096) throw invalid();
      try {
        if (
          (await redis.set(`auth:flow:${flowId}`, value, 'EX', 300, 'NX')) !==
          'OK'
        )
          throw new Error();
      } catch {
        throw new AuthError(503, 'Authentication unavailable');
      }
      return flowId;
    },
    async consume(flowId: string, binding: Binding): Promise<string> {
      if (flowId.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(flowId))
        throw invalid();
      let raw: string | null;
      try {
        raw = await redis.getdel(`auth:flow:${flowId}`);
      } catch {
        throw new AuthError(503, 'Authentication unavailable');
      }
      if (!raw || Buffer.byteLength(raw) > 4096) throw invalid();
      try {
        const value = JSON.parse(raw) as Challenge;
        if (
          value.purpose !== binding.purpose ||
          typeof value.challenge !== 'string' ||
          !value.challenge ||
          (binding.purpose === 'registration' &&
            (value.purpose !== 'registration' ||
              value.userId !== binding.userId ||
              value.sessionId !== binding.sessionId))
        )
          throw invalid();
        return value.challenge;
      } catch {
        throw invalid();
      }
    },
  };
}
