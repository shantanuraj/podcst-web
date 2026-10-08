import postgres from 'postgres';

import { mtls } from './mtls';

const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

const readEnv = (...keys: string[]) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
};

const parsePort = (value?: string) => {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) ? port : undefined;
};

const commonOptions = {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: mtls,
};

const createSql = () => {
  const pgHost = readEnv('PG_HOST', 'PGHOST');

  if (!isVercel && pgHost) {
    const socketConnectionString = process.env.DATABASE_URL;
    if (socketConnectionString) {
      return postgres(socketConnectionString, {
        ...commonOptions,
        host: pgHost,
      });
    }
    return postgres({
      ...commonOptions,
      host: pgHost,
      ...(parsePort(readEnv('PG_PORT', 'PGPORT')) && {
        port: parsePort(readEnv('PG_PORT', 'PGPORT')),
      }),
      ...(readEnv('PG_DATABASE', 'PGDATABASE', 'PG_DB') && {
        database: readEnv('PG_DATABASE', 'PGDATABASE', 'PG_DB'),
      }),
      ...(readEnv('PG_USER', 'PGUSER', 'PG_USERNAME', 'PGUSERNAME') && {
        user: readEnv('PG_USER', 'PGUSER', 'PG_USERNAME', 'PGUSERNAME'),
      }),
      ...(readEnv('PG_PASSWORD', 'PGPASSWORD') && {
        password: readEnv('PG_PASSWORD', 'PGPASSWORD'),
      }),
    });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL or PG_HOST environment variable is required');
  }

  return postgres(connectionString, commonOptions);
};

let client: ReturnType<typeof createSql> | undefined;
const getSql = () => (client ??= createSql());

export const sql = new Proxy(
  createSql as unknown as ReturnType<typeof createSql>,
  {
    apply(_target, _thisArg, args) {
      return Reflect.apply(getSql(), undefined, args);
    },
    get(_target, property) {
      const sql = getSql();
      const value = Reflect.get(sql, property);
      return typeof value === 'function' ? value.bind(sql) : value;
    },
  },
);
