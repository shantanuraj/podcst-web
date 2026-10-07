import { expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import proxy from '../../proxy';

const request = (headers: Record<string, string>) =>
  new NextRequest('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    headers,
  });

test('guards browser mutations and explicitly admits native clients', () => {
  const origin =
    process.env.WEBAUTHN_RP_ORIGIN ||
    process.env.WEBAUTHN_ORIGIN ||
    'http://localhost:3000';
  for (const headers of [
    { origin, 'sec-fetch-site': 'same-origin' },
    { 'x-podcst-client': 'native' },
  ] as Record<string, string>[])
    expect(proxy(request(headers)).status).toBe(200);
  for (const headers of [
    {},
    { origin: 'https://attacker.invalid' },
    { origin: 'null' },
    { origin, 'sec-fetch-site': 'cross-site' },
    { 'x-podcst-client': 'native', origin: 'https://attacker.invalid' },
    { 'x-podcst-client': 'native', 'sec-fetch-mode': 'no-cors' },
  ] as Record<string, string>[]) {
    const response = proxy(request(headers));
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});
