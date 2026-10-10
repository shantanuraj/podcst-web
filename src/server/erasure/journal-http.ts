import { createHash, type KeyObject, timingSafeEqual } from 'node:crypto';
import { readJsonBody } from '../http/json-body';
import {
  canonical,
  type ErasurePayload,
  type JournalClient,
  type JournalEntry,
  JournalError,
  type JournalHead,
  payloadHash,
  type ReceiptRegistration,
  type Signed,
  verifyEntry,
} from './journal-contract';
import type { createPostgresJournal } from './journal-postgres';

type Service = ReturnType<typeof createPostgresJournal>;
type Role = 'runtime' | 'recovery' | 'admission';
const headers = { 'Cache-Control': 'private, no-store' };
const hash = (value: string) => createHash('sha256').update(value).digest();

export function createJournalHandler(
  service: Service,
  tokens: ReadonlyMap<Role, string>,
) {
  if (
    tokens.size !== 3 ||
    new Set(tokens.values()).size !== tokens.size ||
    [...tokens.values()].some((token) => token.length < 43)
  )
    throw new JournalError(503);
  const credentials = [...tokens].map(
    ([role, token]) => [role, hash(`Bearer ${token}`)] as const,
  );
  return async (request: Request) => {
    try {
      if (request.method !== 'POST')
        return Response.json(
          { error: 'Unavailable' },
          { status: 405, headers },
        );
      const supplied = hash(request.headers.get('authorization') ?? '');
      const role = credentials.find(([, expected]) =>
        timingSafeEqual(supplied, expected),
      )?.[0];
      if (!role) throw new JournalError(403);
      const body = await readJsonBody(request, 16 * 1024, 5000, {});
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new JournalError(400);
      const value = body as Record<string, unknown>;
      const path = new URL(request.url).pathname;
      const fields = (names: string[]) => {
        if (Object.keys(value).sort().join(',') !== names.sort().join(','))
          throw new JournalError(400);
      };
      let result: unknown;
      if (role === 'runtime') {
        if (path === '/publish') {
          fields(['epoch', 'payload']);
          result = await service.publish(
            value.epoch as string,
            value.payload as ErasurePayload,
          );
        } else if (path === '/lookup') {
          fields(['operationId', 'payloadHash']);
          result = await service.lookup(
            value.operationId as string,
            value.payloadHash as string,
          );
        } else if (path === '/receipts/register') {
          await service.registerReceipt(
            value as unknown as ReceiptRegistration,
          );
          result = null;
        } else if (path === '/receipts/resolve') {
          fields(['digest']);
          result = await service.resolveReceipt(value.digest as string);
        } else throw new JournalError(403);
      } else if (role === 'recovery') {
        if (path === '/head') {
          fields([]);
          result = await service.head();
        } else if (path === '/seal') {
          fields(['epoch']);
          result = await service.seal(value.epoch as string);
        } else if (path === '/range') {
          fields(['base', 'head', 'limit']);
          result = await service.readRange(
            value.base as JournalHead,
            value.head as JournalHead,
            value.limit as number,
          );
        } else throw new JournalError(403);
      } else if (path === '/epochs/open') {
        fields(['head', 'epoch']);
        result = await service.openEpoch(
          value.head as JournalHead,
          value.epoch as string,
        );
      } else throw new JournalError(403);
      return Response.json(result, { headers });
    } catch (error) {
      return Response.json(
        { error: 'Recovery evidence unavailable' },
        {
          status: error instanceof JournalError ? error.status : 503,
          headers,
        },
      );
    }
  };
}

export function createJournalClient({
  url,
  token,
  journalId,
  keys,
  fetcher = fetch,
  allowLoopback = false,
}: {
  url: string;
  token: string;
  journalId: string;
  keys: ReadonlyMap<string, KeyObject>;
  fetcher?: typeof fetch;
  allowLoopback?: boolean;
}): JournalClient {
  const origin = new URL(url);
  if (
    token.length < 43 ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(
        allowLoopback &&
        origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(origin.hostname)
      ))
  )
    throw new JournalError(503);
  const call = async (path: string, body: unknown) => {
    const response = await fetcher(new URL(path, origin), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new JournalError(response.status === 409 ? 409 : 503);
    }
    return readJsonBody(
      new Request(origin, {
        method: 'POST',
        body: response.body,
        duplex: 'half',
      } as RequestInit),
      64 * 1024,
      5000,
      {},
    );
  };
  const checked = (value: unknown) => {
    const envelope = value as Signed<JournalEntry>;
    verifyEntry(envelope, keys, journalId);
    return envelope;
  };
  return {
    async publish(epoch, payload) {
      const result = checked(await call('/publish', { epoch, payload }));
      if (
        result.value.epoch !== epoch ||
        canonical(result.value.payload) !== canonical(payload)
      )
        throw new JournalError(503);
      return result;
    },
    async lookup(operationId, expectedHash) {
      const value = await call('/lookup', {
        operationId,
        payloadHash: expectedHash,
      });
      if (value === null) return null;
      const result = checked(value);
      if (
        result.value.payload.operationId !== operationId ||
        payloadHash(result.value.payload) !== expectedHash
      )
        throw new JournalError(503);
      return result;
    },
    async registerReceipt(receipt) {
      if ((await call('/receipts/register', receipt)) !== null)
        throw new JournalError(503);
    },
    async resolveReceipt(digest) {
      const value = (await call('/receipts/resolve', { digest })) as Awaited<
        ReturnType<JournalClient['resolveReceipt']>
      >;
      if (value === null) return null;
      if (
        !value ||
        Object.keys(value).sort().join(',') !== 'entry,operationId' ||
        typeof value.operationId !== 'string'
      )
        throw new JournalError(503);
      const entry = value.entry === null ? null : checked(value.entry);
      if (entry && entry.value.payload.operationId !== value.operationId)
        throw new JournalError(503);
      return { operationId: value.operationId, entry };
    },
  };
}
