import type { Redis } from 'ioredis';
import { JournalError } from './journal-contract';

export const authEpochKey = (epoch: string) => `auth:epoch:${epoch}`;
export const authFlowKey = (epoch: string, flow: string) =>
  `auth:flow:${epoch}:${flow}`;
export async function redisIdentity(redis: Pick<Redis, 'info'>) {
  const identity = (await redis.info('server')).match(
    /^run_id:([a-f0-9]{40})\r?$/m,
  )?.[1];
  if (!identity) throw new JournalError(503);
  return identity;
}
export async function assertAuthEpoch(
  redis: Pick<Redis, 'get' | 'info'>,
  epoch: string,
  runId: string,
  instance?: string,
) {
  if (
    (await redis.get(authEpochKey(epoch))) !== runId ||
    (instance !== undefined && (await redisIdentity(redis)) !== instance)
  )
    throw new JournalError(503);
}
