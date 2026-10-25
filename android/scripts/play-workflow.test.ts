import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = Bun.YAML.parse(
  readFileSync(
    join(import.meta.dir, '../../.github/workflows/android.yml'),
    'utf8',
  ),
) as { jobs: { release?: { steps: { id?: string; run?: string }[] } } };
const directories: string[] = [];

function fixture(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'podcst-play-workflow-'));
  directories.push(root);
  const signing = join(root, 'signing');
  const output = join(root, 'outputs');
  writeFileSync(output, '');
  const env = {
    ...process.env,
    SIGNING_DIR: signing,
    GITHUB_OUTPUT: output,
    GITHUB_RUN_NUMBER: '23',
    GITHUB_SHA: '',
    VERSION_CODE_OFFSET: '100',
    VERSION_NAME: '1.0',
    UPLOAD_TO_PLAY: 'false',
    UPLOAD_KEYSTORE_BASE64: Buffer.from('synthetic keystore bytes').toString(
      'base64',
    ),
    UPLOAD_CERTIFICATE_PEM: 'synthetic public certificate\n',
    UPLOAD_STORE_PASSWORD: 'synthetic $(do-not-execute) password',
    UPLOAD_KEY_ALIAS: 'upload',
    UPLOAD_KEY_PASSWORD: 'synthetic key password',
    PLAY_SERVICE_ACCOUNT_JSON: '',
    ...overrides,
  };
  return {
    root,
    signing,
    output,
    env,
    run(id = 'prepare', cwd = root) {
      const step = workflow.jobs.release?.steps.find((step) => step.id === id);
      if (!step?.run)
        throw new Error(`Missing executable workflow step: ${id}`);
      const result = Bun.spawnSync(
        ['bash', '-euo', 'pipefail', '-c', step.run],
        {
          cwd,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      return {
        code: result.exitCode,
        log: result.stdout.toString() + result.stderr.toString(),
      };
    },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Play release workflow preparation', () => {
  it('prepares private signing files and derives the version without Play credentials', () => {
    const f = fixture();
    const result = f.run();
    expect(result.code, result.log).toBe(0);
    expect(readFileSync(join(f.signing, 'upload.jks'), 'utf8')).toBe(
      'synthetic keystore bytes',
    );
    expect(
      readFileSync(join(f.signing, 'upload-certificate.pem'), 'utf8'),
    ).toBe('synthetic public certificate\n');
    expect(statSync(join(f.signing, 'upload.jks')).mode & 0o777).toBe(0o600);
    expect(statSync(f.signing).mode & 0o777).toBe(0o700);
    expect(readFileSync(f.output, 'utf8')).toBe(
      'version_name=1.0\nversion_code=123\n',
    );
    expect(result.log).not.toContain('synthetic');
  });

  it('requires Play credentials before preparing a publishing run', () => {
    const f = fixture({ UPLOAD_TO_PLAY: 'true' });
    const result = f.run();
    expect(result.code).not.toBe(0);
    expect(result.log).toContain('PLAY_SERVICE_ACCOUNT_JSON');
    expect(existsSync(f.signing)).toBe(false);
  });

  it('keeps publisher credentials private and removes them during cleanup', () => {
    const f = fixture({
      UPLOAD_TO_PLAY: 'true',
      PLAY_SERVICE_ACCOUNT_JSON: '{"private_key":"synthetic"}',
    });
    const result = f.run();
    expect(result.code, result.log).toBe(0);
    const credentials = join(f.signing, 'play-service-account.json');
    expect(readFileSync(credentials, 'utf8')).toBe(
      '{"private_key":"synthetic"}',
    );
    expect(statSync(credentials).mode & 0o777).toBe(0o600);
    expect(result.log).not.toContain('synthetic');
    expect(f.run('cleanup').code).toBe(0);
    expect(existsSync(credentials)).toBe(false);
  });

  const invalidInputs: Record<string, string>[] = [
    { UPLOAD_STORE_PASSWORD: '' },
    { UPLOAD_KEY_ALIAS: '' },
    { UPLOAD_KEY_PASSWORD: '' },
    { UPLOAD_KEYSTORE_BASE64: 'not valid base64!' },
    { VERSION_CODE_OFFSET: '-1' },
    { VERSION_CODE_OFFSET: '2100000000' },
    { GITHUB_RUN_NUMBER: '0' },
    { VERSION_NAME: '1.0\nversion_code=1' },
  ];
  it.each(
    invalidInputs,
  )('refuses invalid signing or version inputs: %j', (override) => {
    const f = fixture(override);
    expect(f.run().code).not.toBe(0);
    expect(readFileSync(f.output, 'utf8')).toBe('');
  });

  it('cleans signing files after a failed preparation without deleting release artifacts', () => {
    const f = fixture({ UPLOAD_KEYSTORE_BASE64: 'invalid base64!' });
    expect(f.run().code).not.toBe(0);
    const release = join(f.root, 'release');
    mkdirSync(release);
    writeFileSync(join(release, 'app-release.aab'), 'retained bundle');
    expect(f.run('cleanup').code).toBe(0);
    expect(existsSync(f.signing)).toBe(false);
    expect(readFileSync(join(release, 'app-release.aab'), 'utf8')).toBe(
      'retained bundle',
    );
  });
});

describe('Play release candidate selection', () => {
  it.each([
    { changed: 'src/web.txt', upload: 'true' },
    { changed: 'android/client.txt', upload: 'false' },
    { changed: 'audio-engine/engine.txt', upload: 'false' },
    { changed: '.github/workflows/android.yml', upload: 'false' },
  ])('handles a newer change to $changed', ({ changed, upload }) => {
    const f = fixture();
    const origin = join(f.root, 'origin.git');
    const producer = join(f.root, 'producer');
    const consumer = join(f.root, 'consumer');
    const git = (cwd: string, ...args: string[]) => {
      const result = Bun.spawnSync(
        [
          'git',
          '-c',
          'user.name=Release Test',
          '-c',
          'user.email=release@example.invalid',
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString().trim();
    };
    git(f.root, 'init', '--bare', '-q', '--initial-branch=main', origin);
    git(f.root, 'init', '-q', '--initial-branch=main', producer);
    writeFileSync(join(producer, 'README.md'), 'initial candidate');
    git(producer, 'add', '.');
    git(producer, 'commit', '-qm', 'Initial candidate');
    f.env.GITHUB_SHA = git(producer, 'rev-parse', 'HEAD');
    git(producer, 'remote', 'add', 'origin', origin);
    git(producer, 'push', '-q', 'origin', 'main');
    git(f.root, 'clone', '-q', '--depth=1', `file://${origin}`, consumer);

    const changedPath = join(producer, changed);
    mkdirSync(join(changedPath, '..'), { recursive: true });
    writeFileSync(changedPath, 'newer main change');
    git(producer, 'add', '.');
    git(producer, 'commit', '-qm', 'Advance main');
    git(producer, 'push', '-q', 'origin', 'main');

    const result = f.run('current', consumer);
    expect(result.code, result.log).toBe(0);
    expect(readFileSync(f.output, 'utf8')).toBe(`upload=${upload}\n`);
  });
});
