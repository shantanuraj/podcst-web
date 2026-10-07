import { Resend } from 'resend';
import { sql } from '../db';
import { createRedis } from '../redis';
import { createCodeDelivery } from './email-delivery';
import { createEmailHandlers } from './email-handlers';
import { createEmailService } from './email-service';
import { AuthError } from './error';
import { createAuthLimiter, trustedAuthSource } from './limits';
import { setSessionCookie } from './session';

let resend: Resend | undefined;
let redis: ReturnType<typeof createRedis> | undefined;

const secret = () => {
  const value = process.env.AUTH_CODE_SECRET;
  if (!value || !/^[a-f0-9]{64,}$/i.test(value))
    throw new AuthError(503, 'Authentication unavailable');
  return value;
};

const deliver = createCodeDelivery((message) => {
  if (!process.env.RESEND_API_KEY)
    throw new AuthError(503, 'Authentication unavailable');
  resend ??= new Resend(process.env.RESEND_API_KEY);
  return resend.emails.send(message);
}, process.env.EMAIL_FROM || 'Podcst <noreply@updates.podcst.app>');

export const emailHandlers = createEmailHandlers(
  () => createEmailService(sql, secret(), deliver),
  async (request, kind, email) => {
    const key = secret();
    if (!redis) {
      redis = createRedis();
      redis.on('error', () => {});
    }
    await createAuthLimiter(redis, key)(
      kind,
      email,
      trustedAuthSource(request, process.env.AUTH_TRUSTED_IP_HEADER),
    );
  },
  setSessionCookie,
);
