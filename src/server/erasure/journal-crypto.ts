import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { canonical, JournalError } from './journal-contract';

export function encryptEvidence(
  value: Buffer,
  key: Buffer | undefined,
  context: unknown,
) {
  if (key?.length !== 32) throw new JournalError(503);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(canonical(context)));
  const body = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}
export function decryptEvidence(
  value: Buffer,
  key: Buffer | undefined,
  context: unknown,
) {
  try {
    if (key?.length !== 32 || value.length <= 28) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    cipher.setAAD(Buffer.from(canonical(context)));
    cipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]);
  } catch {
    throw new JournalError(503);
  }
}
