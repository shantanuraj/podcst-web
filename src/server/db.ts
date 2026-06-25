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
  types: {
    bigint: {
      to: 20,
      from: [20],
      serialize: (n: number) => n.toString(),
      parse: (s: string) => Number(s),
    },
  },
};

const createSql = () => {
  const pgHost = readEnv('PG_HOST', 'PGHOST');

  if (!isVercel && pgHost) {
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

export const sql = createSql();
