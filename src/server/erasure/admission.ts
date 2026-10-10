import { createPublicKey, type KeyObject, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { sql } from '../db';
import { readJsonBody } from '../http/json-body';
import {
  canonical,
  isOperationId,
  JournalError,
  type Signed,
  verifyValue,
} from './journal-contract';
import type {
  AdmissionAttestation,
  AdmissionResponse,
} from './recovery-control';
import { admissionBinding } from './recovery-state';

export const ADMISSION_CHALLENGE = 'x-podcst-admission-challenge';
export const ADMISSION_RESPONSE = 'x-podcst-admission-response';

export const admissionRequired = () =>
  process.env.RECOVERY_ADMISSION_REQUIRED === '1' ||
  process.env.ACCOUNT_ERASURE_ENABLED === '1';

export function createAdmissionGuard({
  sql,
  url,
  token,
  epoch,
  keys,
  fetcher = fetch,
  allowLoopback = false,
}: {
  sql: postgres.Sql;
  url: string;
  token: string;
  epoch: string;
  keys: ReadonlyMap<string, KeyObject>;
  fetcher?: typeof fetch;
  allowLoopback?: boolean;
}) {
  const target = new URL(url);
  if (
    token.length < 43 ||
    !isOperationId(epoch) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/' ||
    (target.protocol !== 'https:' &&
      !(
        allowLoopback &&
        target.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(target.hostname)
      ))
  )
    throw new JournalError(503);
  return async (nonce: string = randomUUID()) => {
    if (!isOperationId(nonce)) throw new JournalError(503);
    const binding = await admissionBinding(sql, epoch);
    const signal = AbortSignal.timeout(5000);
    const response = await fetcher(new URL('/admission/check', target), {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ binding, nonce }),
      signal,
    });
    if (!response.ok) throw new JournalError(503);
    const envelope = (await readJsonBody(
      { body: response.body, headers: response.headers, signal },
      16 * 1024,
      5000,
      {},
    )) as Signed<{
      purpose: 'admission-probe';
      nonce: string;
      attestation: Signed<AdmissionAttestation>;
      response: Signed<AdmissionResponse>;
    }>;
    const probe = verifyValue(envelope, keys);
    if (probe.purpose !== 'admission-probe' || probe.nonce !== nonce)
      throw new JournalError(503);
    const proof = verifyValue(probe.attestation, keys);
    const {
      version,
      purpose,
      schemaHash: _s,
      catalogHash: _c,
      redisIdentity: _r,
      head: _h,
      ...expected
    } = proof;
    if (
      version !== 1 ||
      purpose !== 'recovery-admission' ||
      canonical(expected) !== canonical(binding)
    )
      throw new JournalError(503);
    if (canonical(await admissionBinding(sql, epoch)) !== canonical(binding))
      throw new JournalError(503);
    return { ...proof, response: probe.response };
  };
}
let guard: ReturnType<typeof createAdmissionGuard> | undefined;
export async function requireRuntimeAdmission(db = sql, nonce?: string) {
  if (!admissionRequired()) return undefined;
  if (!guard || db !== sql) {
    const {
      ERASURE_JOURNAL_URL: url,
      ERASURE_JOURNAL_TOKEN: token,
      ERASURE_WRITER_EPOCH: epoch,
      ERASURE_VERIFICATION_KEYS: json,
    } = process.env;
    if (!url || !token || !epoch || !json) throw new JournalError(503);
    const instance = createAdmissionGuard({
      sql: db,
      url,
      token,
      epoch,
      keys: new Map(
        Object.entries(JSON.parse(json) as Record<string, string>).map(
          ([id, pem]) => [id, createPublicKey(pem)],
        ),
      ),
    });
    if (db !== sql) return instance(nonce);
    guard = instance;
  }
  return guard(nonce);
}

export function createAdmissionGateway<T>(
  assert: () => Promise<T>,
  upstream: (request: Request, proof: T) => Promise<Response>,
) {
  return async (request: Request) => {
    try {
      const proof = await assert();
      return await upstream(request, proof);
    } catch {
      return Response.json(
        { message: 'Service unavailable' },
        {
          status: 503,
          headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' },
        },
      );
    }
  };
}
