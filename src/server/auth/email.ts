import { Resend } from 'resend';
import { sql } from '../db';
import { generateId } from './session';

const FROM_EMAIL = process.env.EMAIL_FROM || 'Podcst <noreply@updates.podcst.app>';

let resend: Resend | null = null;
function getResend(): Resend {
  if (!resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required');
    }
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}
const CODE_EXPIRY_MINUTES = 10;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationCode(email: string): Promise<{ id: string }> {
  const code = generateCode();
  const id = generateId();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

  await sql`
    UPDATE email_verifications
    SET used = true
    WHERE email = ${email} AND used = false
  `;

  await sql`
    INSERT INTO email_verifications (id, email, code, expires_at)
    VALUES (${id}, ${email}, ${code}, ${expiresAt})
  `;

  await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Your Podcst verification code',
    text: `Your verification code is: ${code}\n\nThis code expires in ${CODE_EXPIRY_MINUTES} minutes.`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; margin-bottom: 24px;">Podcst</h1>
        <p style="font-size: 16px; color: #333; margin-bottom: 24px;">Your verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 20px; background: #f5f5f5; text-align: center; margin-bottom: 24px;">
          ${code}
        </div>
        <p style="font-size: 14px; color: #666;">This code expires in ${CODE_EXPIRY_MINUTES} minutes.</p>
      </div>
    `,
  });

  return { id };
}

export async function verifyCode(email: string, code: string): Promise<boolean> {
  const [verification] = await sql`
    SELECT id FROM email_verifications
    WHERE email = ${email}
      AND code = ${code}
      AND used = false
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!verification) {
    return false;
  }

  await sql`
    UPDATE email_verifications
    SET used = true
    WHERE id = ${verification.id}
  `;

  return true;
}
