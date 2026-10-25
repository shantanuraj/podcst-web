import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directories: string[] = [];
const tools = ['java', 'jar', 'keytool', 'jarsigner', 'git', 'unzip', 'shasum'];
const available = tools.every((tool) => Bun.which(tool));
let signing: string;

function run(command: string[], cwd: string, env = process.env) {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
  };
}

function checked(command: string[], cwd: string) {
  const result = run(command, cwd);
  expect(result.code, result.output).toBe(0);
}

const mockGradle = `#!/bin/bash
set -euo pipefail
printf '%s\\0' "$@" > "$MOCK_LOG"
[[ ", $* ," == *':app:bundleRelease'* ]] || exit 98
[[ $MOCK_FAIL != build ]] || exit 23
outputs="$(dirname "$0")/app/build/outputs"
mkdir -p "$outputs/bundle/release" "$outputs/mapping/release"
cp "$MOCK_BUNDLE" "$outputs/bundle/release/app-release.aab"
if [[ $MOCK_FAIL != mapping ]]; then
    printf 'synthetic mapping\\n' > "$outputs/mapping/release/mapping.txt"
fi
if [[ $MOCK_FAIL == source ]]; then
    touch "$(dirname "$0")/changed"
fi
`;

function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'android release test ')),
  );
  directories.push(root);
  const repo = join(root, 'checkout');
  const android = join(repo, 'android');
  const script = join(android, 'scripts/build-release.sh');
  const output = join(root, 'release output');
  const log = join(root, 'gradle.log');
  mkdirSync(join(android, 'scripts'), { recursive: true });
  copyFileSync(join(import.meta.dir, 'build-release.sh'), script);
  writeFileSync(join(android, 'gradlew'), mockGradle);
  chmodSync(join(android, 'gradlew'), 0o755);
  writeFileSync(join(repo, '.gitignore'), 'android/app/build/\n');
  checked(['git', 'init', '-q', repo], root);
  checked(['git', 'add', '.'], repo);
  checked(
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
      'commit',
      '-qm',
      'test: Prepare fixture',
    ],
    repo,
  );
  return {
    root,
    repo,
    output,
    log,
    run(args = ['1.2.3', '42', output], env: Record<string, string> = {}) {
      return run(['/bin/bash', script, ...args], root, {
        ...process.env,
        ANDROID_UPLOAD_CERTIFICATE: join(signing, 'upload.pem'),
        MOCK_BUNDLE: join(signing, 'signed.aab'),
        MOCK_LOG: log,
        MOCK_FAIL: '',
        ...env,
      });
    },
  };
}

function bundle(
  name: string,
  options: { missingJni?: boolean; missingSymbols?: boolean } = {},
) {
  const contents = join(signing, name);
  const abi = 'arm64-v8a';
  const native = join(contents, 'base/lib', abi);
  mkdirSync(native, { recursive: true });
  writeFileSync(join(native, 'libdependency.so'), 'synthetic dependency');
  if (!options.missingJni) {
    writeFileSync(join(native, 'libpodcst_audio_jni.so'), 'synthetic JNI');
  }
  if (!options.missingSymbols) {
    const symbols = join(
      contents,
      'BUNDLE-METADATA/com.android.tools.build.debugsymbols',
      abi,
    );
    mkdirSync(symbols, { recursive: true });
    writeFileSync(
      join(symbols, 'libpodcst_audio_jni.so.dbg'),
      'synthetic symbols',
    );
  }
  const path = join(signing, `${name}.aab`);
  checked(['jar', 'cf', path, '-C', contents, '.'], signing);
  return path;
}

function sign(path: string) {
  checked(
    [
      'jarsigner',
      '-keystore',
      join(signing, 'upload.p12'),
      '-storepass',
      'synthetic-only',
      path,
      'upload',
    ],
    signing,
  );
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe.skipIf(!available)(
  'Android signed release (real JDK signatures, stubbed Gradle)',
  () => {
    beforeAll(() => {
      signing = mkdtempSync(join(tmpdir(), 'podcst synthetic signing '));
      for (const [alias, subject] of [
        ['upload', 'Podcst Test'],
        ['debug', 'Android Debug'],
      ]) {
        const keystore = join(signing, `${alias}.p12`);
        checked(
          [
            'keytool',
            '-genkeypair',
            '-alias',
            alias,
            '-keystore',
            keystore,
            '-storepass',
            'synthetic-only',
            '-keypass',
            'synthetic-only',
            '-dname',
            `CN=${subject}`,
            '-keyalg',
            'RSA',
            '-validity',
            '10000',
          ],
          signing,
        );
        checked(
          [
            'keytool',
            '-exportcert',
            '-rfc',
            '-alias',
            alias,
            '-keystore',
            keystore,
            '-storepass',
            'synthetic-only',
            '-file',
            join(signing, `${alias}.pem`),
          ],
          signing,
        );
      }
      bundle('unsigned');
      sign(bundle('signed'));
      sign(bundle('missing-symbols', { missingSymbols: true }));
      sign(bundle('missing-jni', { missingJni: true }));
      copyFileSync(join(signing, 'signed.aab'), join(signing, 'partial.aab'));
      writeFileSync(join(signing, 'addition'), 'unsigned addition');
      checked(
        ['jar', 'uf', join(signing, 'partial.aab'), '-C', signing, 'addition'],
        signing,
      );
      copyFileSync(join(signing, 'signed.aab'), join(signing, 'tampered.aab'));
      const entry = 'base/lib/arm64-v8a/libpodcst_audio_jni.so';
      writeFileSync(join(signing, 'signed', entry), 'modified after signing');
      checked(
        [
          'jar',
          'uf',
          join(signing, 'tampered.aab'),
          '-C',
          join(signing, 'signed'),
          entry,
        ],
        signing,
      );
    }, 30000);

    afterAll(() => {
      if (signing) rmSync(signing, { recursive: true, force: true });
    });

    it('preserves a signed bundle, mapping, symbols and verifiable checksums outside Git', () => {
      const f = fixture();
      const result = f.run();
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain(join(f.output, 'app-release.aab'));
      expect(readFileSync(join(f.output, 'app-release.aab'))).toEqual(
        readFileSync(join(signing, 'signed.aab')),
      );
      expect(readFileSync(join(f.output, 'signature.txt'), 'utf8')).toContain(
        'jar verified',
      );
      expect(readFileSync(join(f.output, 'release.txt'), 'utf8')).toContain(
        'versionName=1.2.3\nversionCode=42',
      );
      expect(readFileSync(join(f.output, 'mapping.txt'), 'utf8')).toContain(
        'synthetic mapping',
      );
      expect(
        existsSync(
          join(
            f.output,
            'native-debug-symbols/arm64-v8a/libpodcst_audio_jni.so.dbg',
          ),
        ),
      ).toBe(true);
      expect(existsSync(join(f.output, '.verification'))).toBe(false);
      expect(statSync(f.output).mode & 0o777).toBe(0o700);
      checked(['shasum', '-a', '256', '-c', 'SHA256SUMS'], f.output);
      const args = readFileSync(f.log, 'utf8').split('\0').filter(Boolean);
      expect(args).toEqual([
        '-p',
        join(f.repo, 'android'),
        '--console=plain',
        '--no-daemon',
        '--no-configuration-cache',
        ':app:bundleRelease',
        '-Ppodcst.release.requireSigning=true',
        '-Ppodcst.release.versionName=1.2.3',
        '-Ppodcst.release.versionCode=42',
      ]);
    });

    it('prints help without signing configuration or a build', () => {
      const f = fixture();
      const result = f.run(['--help'], { ANDROID_UPLOAD_CERTIFICATE: '' });
      expect(result.code).toBe(0);
      expect(result.output).toContain('yarn android:release');
      expect(existsSync(f.log)).toBe(false);
    });

    it('rejects missing and invalid arguments before building', () => {
      const f = fixture();
      for (const args of [
        [],
        ['1.0'],
        ['1.0', '1'],
        ['1.0', '1', f.output, 'extra'],
        ['', '1', f.output],
        ['--help', '1', f.output],
        ...['0', '-1', '01', '1.2', '2100000001', '99999999999'].map((code) => [
          '1.0',
          code,
          f.output,
        ]),
      ]) {
        expect(f.run(args).code).not.toBe(0);
      }
      expect(existsSync(f.log)).toBe(false);
      expect(existsSync(f.output)).toBe(false);
    });

    it('requires an upload certificate and rejects the debug certificate', () => {
      const f = fixture();
      for (const certificate of [
        '',
        join(f.root, 'missing.pem'),
        join(signing, 'debug.pem'),
      ]) {
        expect(
          f.run(undefined, { ANDROID_UPLOAD_CERTIFICATE: certificate }).code,
        ).not.toBe(0);
      }
      expect(existsSync(f.log)).toBe(false);
      expect(existsSync(f.output)).toBe(false);
    });

    it('rejects a dirty checkout', () => {
      const f = fixture();
      writeFileSync(join(f.repo, 'uncommitted'), 'change');
      const result = f.run();
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('Commit or stash');
      expect(existsSync(f.log)).toBe(false);
    });

    it('never overwrites an output directory or writes artifacts inside Git', () => {
      const f = fixture();
      mkdirSync(f.output);
      writeFileSync(join(f.output, 'keep'), 'existing release');
      expect(f.run().code).not.toBe(0);
      expect(readFileSync(join(f.output, 'keep'), 'utf8')).toBe(
        'existing release',
      );
      expect(f.run(['1.0', '1', join(f.repo, 'release')]).code).not.toBe(0);
      expect(existsSync(f.log)).toBe(false);
    });

    for (const [name, error] of [
      ['unsigned', 'signature verification failed'],
      ['partial', 'signature verification failed'],
      ['tampered', 'signature verification failed'],
      ['missing-symbols', 'native debug symbols missing'],
      ['missing-jni', 'JNI library missing'],
    ]) {
      it(`rejects a ${name} bundle and removes incomplete output`, () => {
        const f = fixture();
        const result = f.run(undefined, {
          MOCK_BUNDLE: join(signing, `${name}.aab`),
        });
        expect(result.code, result.output).not.toBe(0);
        expect(result.output).toContain(error);
        expect(existsSync(f.log)).toBe(true);
        expect(existsSync(f.output)).toBe(false);
      });
    }

    it('rejects a bundle signed by a different key', () => {
      const f = fixture();
      const wrong = bundle('wrong');
      checked(
        [
          'jarsigner',
          '-keystore',
          join(signing, 'debug.p12'),
          '-storepass',
          'synthetic-only',
          wrong,
          'debug',
        ],
        signing,
      );
      const result = f.run(undefined, { MOCK_BUNDLE: wrong });
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('signature verification failed');
      expect(existsSync(f.output)).toBe(false);
    });

    for (const [step, error] of [
      ['build', 'Certificate was added'],
      ['mapping', 'mapping.txt is missing'],
      ['source', 'Source changed during the build'],
    ]) {
      it(`stops on ${step} failure without retaining an incomplete release`, () => {
        const f = fixture();
        const result = f.run(undefined, { MOCK_FAIL: step });
        expect(result.code).not.toBe(0);
        expect(result.output).toContain(error);
        expect(existsSync(f.output)).toBe(false);
      });
    }
  },
);
