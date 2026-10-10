import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createTLSFixture(
  directory: string,
  serverNames = 'DNS:localhost,IP:127.0.0.1',
) {
  const openssl = Bun.which('openssl');
  if (!openssl) throw new Error('openssl required');
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([openssl, ...args], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if (result.exitCode !== 0) throw new Error('Synthetic TLS fixture failed');
  };
  const file = (name: string, extension: string) =>
    join(directory, `${name}.${extension}`);
  const ca = file('ca', 'crt');
  const caKey = file('ca', 'key');
  run(
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    caKey,
    '-out',
    ca,
    '-days',
    '1',
    '-subj',
    '/CN=Synthetic recovery CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  );
  const leaf = (name: string, extensions: string) => {
    const key = file(name, 'key');
    const cert = file(name, 'crt');
    const csr = file(name, 'csr');
    const ext = file(name, 'ext');
    writeFileSync(ext, extensions, { mode: 0o600 });
    run(
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      csr,
      '-subj',
      `/CN=${name}`,
    );
    run(
      'x509',
      '-req',
      '-in',
      csr,
      '-CA',
      ca,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      cert,
      '-days',
      '1',
      '-extfile',
      ext,
    );
    return { cert, key };
  };
  return {
    ca,
    server: leaf(
      'server',
      `basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=${serverNames}\n`,
    ),
    client: leaf(
      'client',
      'basicConstraints=CA:FALSE\nextendedKeyUsage=clientAuth\n',
    ),
  };
}
