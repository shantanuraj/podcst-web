import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export class ArtifactError extends Error {}

export function stable(value: unknown): string {
  if (
    typeof value === 'number' &&
    (!Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  ) {
    throw new ArtifactError('Unsafe number in artifact data');
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new ArtifactError('Value is not JSON serializable');
  return encoded;
}

export function digest(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

export function protectedPath(path: string): string {
  const directory = realpathSync(dirname(resolve(path)));
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0)
    throw new ArtifactError('Artifact directory must be private');
  if (stat.uid !== process.getuid?.())
    throw new ArtifactError('Artifact directory must belong to the operator');
  return join(directory, basename(path));
}

export function readProtected(path: string, maxBytes = Infinity) {
  const fd = openSync(
    protectedPath(path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.()
    ) {
      throw new ArtifactError(
        'Artifact must be an operator-owned private regular file',
      );
    }
    if (stat.size > maxBytes)
      throw new ArtifactError('Artifact exceeds the size limit');
    const bytes = readFileSync(fd);
    if (bytes.length > maxBytes)
      throw new ArtifactError('Artifact exceeds the size limit');
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

export function writeProtected(
  path: string,
  value: unknown,
  maxBytes = Infinity,
) {
  const destination = protectedPath(path);
  const encoded = stable(value);
  if (Buffer.byteLength(encoded) > maxBytes)
    throw new ArtifactError('Artifact exceeds the size limit');
  const fd = openSync(
    destination,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, encoded);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (digest(readProtected(destination, maxBytes)) !== digest(value))
    throw new ArtifactError('Backup read-back failed');
  const directory = openSync(dirname(destination), constants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
