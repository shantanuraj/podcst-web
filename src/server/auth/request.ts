export function permitsMutation(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  const expected =
    process.env.WEBAUTHN_RP_ORIGIN ||
    process.env.WEBAUTHN_ORIGIN ||
    'http://localhost:3000';
  if (origin) return origin === expected && (!site || site === 'same-origin');
  return (
    !site &&
    !request.headers.has('sec-fetch-mode') &&
    request.headers.get('x-podcst-client') === 'native'
  );
}
