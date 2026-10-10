import { createPublicKey } from 'node:crypto';
import { Resend } from 'resend';
import { authSecret, limitAuth } from '../auth/backend';
import { createCodeDelivery } from '../auth/email-delivery';
import { AuthError } from '../auth/error';
import { deleteSession, getSession } from '../auth/session';
import { sql } from '../db';
import { requireRuntimeAdmission } from './admission';
import { createErasureHandlers } from './http';
import { createJournalClient } from './journal-http';
import { createErasureService } from './service';

let instance: ReturnType<typeof createErasureService> | undefined;
let resend: Resend | undefined;

export function erasureService() {
  if (process.env.ACCOUNT_ERASURE_ENABLED !== '1')
    throw new AuthError(503, 'Account operation unavailable');
  if (instance) return instance;
  try {
    const {
      ERASURE_JOURNAL_URL: url,
      ERASURE_JOURNAL_TOKEN: token,
      ERASURE_JOURNAL_ID: journalId,
      ERASURE_WRITER_EPOCH: epoch,
      ERASURE_VERIFICATION_KEYS: keyJson,
    } = process.env;
    if (!url || !token || !journalId || !epoch || !keyJson) throw new Error();
    const keys = new Map(
      Object.entries(JSON.parse(keyJson) as Record<string, string>).map(
        ([id, pem]) => [id, createPublicKey(pem)],
      ),
    );
    const journal = createJournalClient({ url, token, journalId, keys });
    const deliver = createCodeDelivery(
      (message) => {
        if (!process.env.RESEND_API_KEY) throw new Error();
        resend ??= new Resend(process.env.RESEND_API_KEY);
        return resend.emails.send(message);
      },
      process.env.EMAIL_FROM || 'Podcst <noreply@updates.podcst.app>',
      10_000,
      'account-erasure',
    );
    instance = createErasureService(sql, {
      journal,
      journalId,
      epoch,
      keys,
      proofSecret: authSecret(),
      admission: requireRuntimeAdmission,
      deliver,
    });
    return instance;
  } catch {
    throw new AuthError(503, 'Account operation unavailable');
  }
}

export const erasureHandlers = createErasureHandlers({
  service: erasureService,
  session: getSession,
  limit: limitAuth,
  clearSession: deleteSession,
});
