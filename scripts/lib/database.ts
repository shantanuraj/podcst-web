import postgres from 'postgres';

export class DatabaseTargetError extends Error {}

export function openDatabase(variable: string) {
  const connectionString = process.env[variable];
  if (!connectionString)
    throw new DatabaseTargetError(
      `${variable} must explicitly select the target database`,
    );
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new DatabaseTargetError(`Invalid ${variable}`);
  }
  const host = target.searchParams.get('host');
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !(host || target.hostname) ||
    target.pathname.length < 2
  ) {
    throw new DatabaseTargetError(
      `${variable} must name a PostgreSQL host and database`,
    );
  }
  target.searchParams.delete('host');
  return postgres(target.toString(), {
    ...(host ? { host } : {}),
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
}
