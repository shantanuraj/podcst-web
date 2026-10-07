import { Resend } from 'resend';
import { sql } from '../db';
import { authSecret, limitAuth } from './backend';
import { createCodeDelivery } from './email-delivery';
import { createEmailHandlers } from './email-handlers';
import { createEmailService } from './email-service';
import { AuthError } from './error';
import { setSessionCookie } from './session';

let resend: Resend | undefined;
const deliver = createCodeDelivery((message) => {
  if (!process.env.RESEND_API_KEY)
    throw new AuthError(503, 'Authentication unavailable');
  resend ??= new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send(message);
}, process.env.EMAIL_FROM || 'Podcst <noreply@updates.podcst.app>');

export const emailHandlers = createEmailHandlers(
  () => createEmailService(sql, authSecret(), deliver),
  limitAuth,
  setSessionCookie,
);
