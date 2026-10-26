import { Resend } from 'resend';
import { authSecret, limitAuth } from '../auth/backend';
import { createCodeDelivery } from '../auth/email-delivery';
import { AuthError } from '../auth/error';
import { getSession } from '../auth/session';
import { sql } from '../db';
import { deletionHandlers } from './http';
import { deletionJournal } from './record';
import { createDeletionService, DELETION_PROOF_MINUTES } from './service';

export function deletionService() {
  const url = process.env.ACCOUNT_DELETION_JOURNAL_URL;
  const secret = process.env.ACCOUNT_DELETION_JOURNAL_SECRET;
  if (!url || !secret)
    throw new AuthError(503, 'Account deletion unavailable; try again');
  return createDeletionService(sql, {
    secret: authSecret(),
    publish: deletionJournal(url, secret),
    deliver: createCodeDelivery(
      (message) => {
        if (!process.env.RESEND_API_KEY)
          throw new AuthError(503, 'Email unavailable');
        return new Resend(process.env.RESEND_API_KEY).emails.send(message);
      },
      process.env.EMAIL_FROM || 'Podcst <noreply@updates.podcst.app>',
      10_000,
      {
        subject: 'Confirm deletion of your Podcst account',
        text: (code) =>
          `Your account deletion code is: ${code}\n\nThis code expires in ${DELETION_PROOF_MINUTES} minutes. Enter it in Podcst only if you want to permanently delete your account. If you did not request deletion, ignore this email.`,
      },
    ),
  });
}

export const accountDeletionHandlers = deletionHandlers({
  service: deletionService,
  session: getSession,
  limit: limitAuth,
});
