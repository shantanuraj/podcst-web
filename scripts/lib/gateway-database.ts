import { createConnection, isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import {
  type ConnectionOptions,
  checkServerIdentity,
  connect as connectTLS,
  createSecureContext,
  type TLSSocket,
} from 'node:tls';
import postgres from 'postgres';

export type GatewayDatabaseConfiguration = {
  port: number;
  database: string;
  role: string;
} & (
  | { socket: string }
  | {
      host: string;
      password: string;
      tls: { ca: string; cert: string; key: string };
    }
);

function verifiedSocket(host: string, port: number, tls: ConnectionOptions) {
  return new Promise<TLSSocket>((resolve, reject) => {
    const raw = createConnection({ host, port });
    let secure: TLSSocket | undefined;
    const fail = (error = new Error('Gateway database TLS unavailable')) => {
      clearTimeout(deadline);
      secure?.destroy();
      raw.destroy();
      reject(error);
    };
    const deadline = setTimeout(fail, 5000);
    raw.once('error', fail);
    raw.once('close', () => fail());
    raw.once('connect', () =>
      raw.write(Buffer.from('0000000804d2162f', 'hex')),
    );
    raw.once('data', (reply) => {
      if (reply.length !== 1 || reply[0] !== 83) return fail();
      secure = connectTLS({ ...tls, socket: raw });
      const connection = secure;
      connection.once('error', fail);
      connection.once('close', (hadError) => {
        if (!hadError && connection.listenerCount('error'))
          connection.emit('error', new Error('Gateway database TLS closed'));
        fail();
      });
      connection.once('secureConnect', () => {
        if (!connection.authorized) return fail();
        clearTimeout(deadline);
        resolve(connection);
      });
    });
  });
}

export function createGatewayDatabase(config: GatewayDatabaseConfiguration) {
  const local = 'socket' in config;
  const fields = [
    'database',
    'port',
    'role',
    ...(local ? ['socket'] : ['host', 'password', 'tls']),
  ];
  if (
    Object.keys(config).sort().join(',') !== fields.sort().join(',') ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    ![config.database, config.role].every(
      (name) => typeof name === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(name),
    )
  )
    throw new Error('Gateway database identity refused');
  let ssl: false | ConnectionOptions = false;
  let host: string;
  let password = '';
  if (local) {
    if (typeof config.socket !== 'string' || !isAbsolute(config.socket))
      throw new Error('Gateway database socket refused');
    host = config.socket;
  } else {
    if (
      typeof config.host !== 'string' ||
      !(
        isIP(config.host) ||
        /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(config.host)
      ) ||
      typeof config.password !== 'string' ||
      !config.password ||
      !config.tls ||
      Object.keys(config.tls).sort().join(',') !== 'ca,cert,key' ||
      Object.values(config.tls).some(
        (value) => typeof value !== 'string' || !value.trim(),
      )
    )
      throw new Error('Gateway database mutual TLS required');
    host = config.host;
    password = config.password;
    ssl = {
      ...config.tls,
      rejectUnauthorized: true,
      ...(!isIP(host) && { servername: host }),
      checkServerIdentity: (_hostname, certificate) =>
        checkServerIdentity(host, certificate),
    };
    createSecureContext(ssl);
  }
  return postgres({
    host,
    port: config.port,
    database: config.database,
    username: config.role,
    password,
    ssl: false,
    ...(ssl && { socket: () => verifiedSocket(host, config.port, ssl) }),
    max: 6,
    connect_timeout: 5,
    idle_timeout: 20,
    connection: {
      application_name: 'podcst-recovery-gateway',
      default_transaction_read_only: true,
      statement_timeout: 5000,
    },
    onnotice: () => {},
  });
}
