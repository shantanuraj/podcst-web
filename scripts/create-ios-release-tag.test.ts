import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIOSReleaseTag } from './create-ios-release-tag.mjs';

const directories: string[] = [];
const originalCommit = process.env.RELEASE_COMMIT;
const originalTag = process.env.RELEASE_TAG;

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  if (originalCommit === undefined) delete process.env.RELEASE_COMMIT;
  else process.env.RELEASE_COMMIT = originalCommit;
  if (originalTag === undefined) delete process.env.RELEASE_TAG;
  else process.env.RELEASE_TAG = originalTag;
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'podcst-ios-tag-'));
  directories.push(directory);
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commitFile = (
    path: string,
    text: string,
    message = 'Update fixture',
  ) => {
    writeFileSync(join(directory, path), text);
    git(['add', path]);
    git([
      '-c',
      'user.name=Release test',
      '-c',
      'user.email=release@example.invalid',
      'commit',
      '-qm',
      message,
    ]);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-qb', 'main']);
  mkdirSync(join(directory, 'ios'));
  const nativeCommit = commitFile(
    'ios/App.xcconfig',
    'MARKETING_VERSION = 1.0\n',
  );
  const commit = commitFile('web.txt', 'An unrelated web change\n');
  git(['update-ref', 'refs/remotes/origin/main', commit]);
  process.env.RELEASE_COMMIT = commit;
  process.env.RELEASE_TAG = 'ios-1.0';

  const context = {
    repo: { owner: 'shantanuraj', repo: 'podcst-web' },
    ref: 'refs/heads/main',
    eventName: 'workflow_dispatch',
    actor: 'release-manager',
    runId: 42,
  };
  const requests: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const outputs: Record<string, unknown> = {};
  const summary: unknown[] = [];
  let remoteTag: { object: { type: string; sha: string } } | null = null;
  const runs: Record<string, Record<string, unknown>[]> = {
    'ci.yml': [successRun(commit, 1)],
    'audio.yml': [successRun(nativeCommit, 2)],
  };
  const github = {
    rest: {
      git: {
        getRef: async () => {
          if (!remoteTag)
            throw Object.assign(new Error('Not found'), { status: 404 });
          return { data: remoteTag };
        },
        createRef: async (input: Record<string, unknown>) => {
          writes.push(input);
          remoteTag = { object: { type: 'commit', sha: String(input.sha) } };
        },
      },
      actions: {
        listWorkflowRuns: async (input: Record<string, unknown>) => {
          requests.push(input);
          return { data: { workflow_runs: runs[String(input.workflow_id)] } };
        },
      },
    },
  };
  const summaryWriter = {
    addHeading: (value: unknown) => {
      summary.push(value);
      return summaryWriter;
    },
    addRaw: (value: unknown) => {
      summary.push(value);
      return summaryWriter;
    },
    addTable: (value: unknown) => {
      summary.push(value);
      return summaryWriter;
    },
    write: async () => {},
  };
  const core = {
    setOutput: (name: string, value: unknown) => {
      outputs[name] = value;
    },
    summary: summaryWriter,
  };
  return {
    directory,
    git,
    commitFile,
    commit,
    nativeCommit,
    context,
    requests,
    writes,
    outputs,
    summary,
    runs,
    github,
    setTag: (sha: string, type = 'commit') => {
      remoteTag = { object: { type, sha } };
    },
    run: () => createIOSReleaseTag({ github, context, core, exec: git }),
  };
}

function successRun(sha: string, id: number) {
  return {
    head_sha: sha,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/shantanuraj/podcst-web/actions/runs/${id}`,
  };
}

test('tags the exact tested main commit and inherits native CI across web-only changes', async () => {
  const f = fixture();
  expect(await f.run()).toEqual({
    tag: 'ios-1.0',
    commit: f.commit,
    created: true,
  });
  expect(f.writes).toEqual([
    {
      owner: 'shantanuraj',
      repo: 'podcst-web',
      ref: 'refs/tags/ios-1.0',
      sha: f.commit,
    },
  ]);
  expect(
    f.requests.map((request) => [
      request.workflow_id,
      request.head_sha,
      request.event,
      request.branch,
      request.per_page,
    ]),
  ).toEqual([
    ['ci.yml', f.commit, 'push', 'main', 1],
    ['audio.yml', undefined, 'push', 'main', 100],
  ]);
  expect(f.outputs.created).toBe(true);
  expect(JSON.stringify(f.summary)).toContain('does not submit or release');
  expect(JSON.stringify(f.summary)).toContain('@release-manager');
  expect(JSON.stringify(f.summary)).toContain('/actions/runs/42');
});

test.each([
  'ios-1.0',
  'ios-1.0-rc.1',
  'ios-1.0-rc.12',
])('supports immutable version or candidate tag %s', async (tag) => {
  const f = fixture();
  process.env.RELEASE_TAG = tag;
  await f.run();
  expect(f.writes[0].ref).toBe(`refs/tags/${tag}`);
});

test.each([
  'ios-1.0-rc.0',
  'ios-01.0',
  'ios-1',
  'ios-1.0\n',
  'ios-1.0;echo unsafe',
  'v1.0',
])('rejects malformed tag %s without mutation', async (tag) => {
  const f = fixture();
  process.env.RELEASE_TAG = tag;
  await expect(f.run()).rejects.toThrow('Use ios-');
  expect(f.writes).toHaveLength(0);
});

test('rejects shortened or executable commit input', async () => {
  const f = fixture();
  process.env.RELEASE_COMMIT = 'HEAD; echo unsafe';
  await expect(f.run()).rejects.toThrow('40-character');
  expect(f.requests).toHaveLength(0);
  expect(f.writes).toHaveLength(0);
});

test.each([
  'ref',
  'eventName',
  'repo',
])('rejects the wrong workflow %s', async (field) => {
  const f = fixture();
  if (field === 'ref') f.context.ref = 'refs/heads/feature';
  else if (field === 'eventName') f.context.eventName = 'push';
  else f.context.repo.owner = 'someone-else';
  await expect(f.run()).rejects.toThrow('manually from podcst-web main');
  expect(f.writes).toHaveLength(0);
});

test('rejects a commit outside main', async () => {
  const f = fixture();
  gitFeature(f);
  process.env.RELEASE_COMMIT = f.commitFile('feature.txt', 'Not merged\n');
  await expect(f.run()).rejects.toThrow('not on origin/main');
  expect(f.writes).toHaveLength(0);
});

function gitFeature(f: ReturnType<typeof fixture>) {
  f.git(['checkout', '-qb', 'feature']);
}

test('rejects a version mismatch and duplicate marketing versions', async () => {
  const f = fixture();
  process.env.RELEASE_TAG = 'ios-1.1';
  await expect(f.run()).rejects.toThrow('MARKETING_VERSION');
  process.env.RELEASE_TAG = 'ios-1.0';
  const candidate = f.commitFile(
    'ios/App.xcconfig',
    'MARKETING_VERSION = 1.0\nMARKETING_VERSION = 1.0\n',
  );
  f.git(['update-ref', 'refs/remotes/origin/main', candidate]);
  process.env.RELEASE_COMMIT = candidate;
  await expect(f.run()).rejects.toThrow('MARKETING_VERSION');
  expect(f.writes).toHaveLength(0);
});

test('rejects a Cloud-skipped candidate', async () => {
  const f = fixture();
  const candidate = f.commitFile('web.txt', 'More work\n', 'Update [ci skip]');
  f.git(['update-ref', 'refs/remotes/origin/main', candidate]);
  process.env.RELEASE_COMMIT = candidate;
  await expect(f.run()).rejects.toThrow('prevents Xcode Cloud');
  expect(f.writes).toHaveLength(0);
});

test.each([
  'ci.yml',
  'audio.yml',
])('rejects missing, pending or failed latest %s even when an older run passed', async (workflow) => {
  const f = fixture();
  const success = f.runs[workflow][0];
  for (const run of [
    undefined,
    { ...success, status: 'in_progress', conclusion: null },
    { ...success, conclusion: 'failure' },
  ]) {
    f.runs[workflow] = run ? [run, success] : [];
    await expect(f.run()).rejects.toThrow(
      workflow === 'audio.yml' && !run
        ? 'No main-push Native audio run'
        : `${workflow} must have a successful latest`,
    );
    expect(f.writes).toHaveLength(0);
  }
});

test('a same-target rerun does not recreate the tag', async () => {
  const f = fixture();
  await f.run();
  expect(await f.run()).toEqual({
    tag: 'ios-1.0',
    commit: f.commit,
    created: false,
  });
  expect(f.writes).toHaveLength(1);
  expect(JSON.stringify(f.summary)).toContain('no new tag event');
  expect(JSON.stringify(f.summary)).toContain('rerun the build in Xcode Cloud');
});

test('an existing tag never moves to a new candidate', async () => {
  const f = fixture();
  f.setTag(f.nativeCommit);
  await expect(f.run()).rejects.toThrow('Tags are never moved');
  expect(f.writes).toHaveLength(0);
});

test('a concurrent identical tag creation is an idempotent success', async () => {
  const f = fixture();
  f.github.rest.git.createRef = async () => {
    f.setTag(f.commit);
    throw Object.assign(new Error('Reference already exists'), { status: 422 });
  };
  expect(await f.run()).toEqual({
    tag: 'ios-1.0',
    commit: f.commit,
    created: false,
  });
});

test('a failed creation with no matching tag stays a failure', async () => {
  const f = fixture();
  f.github.rest.git.createRef = async () => {
    f.setTag(f.nativeCommit);
    throw new Error('Reference rejected');
  };
  await expect(f.run()).rejects.toThrow('Reference rejected');
  expect(f.outputs.created).toBeUndefined();
});

test('remote permission errors cannot be mistaken for an absent tag', async () => {
  const f = fixture();
  f.github.rest.git.getRef = async () => {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  };
  await expect(f.run()).rejects.toThrow('Forbidden');
  expect(f.writes).toHaveLength(0);
  expect(f.requests).toHaveLength(0);
});

test('native validation uses the main merge commit, not an unmerged PR check', async () => {
  const f = fixture();
  gitFeature(f);
  f.commitFile(
    'ios/App.xcconfig',
    'MARKETING_VERSION = 1.0\nCURRENT_PROJECT_VERSION = 1\n',
  );
  f.git(['checkout', 'main']);
  f.git([
    '-c',
    'user.name=Release test',
    '-c',
    'user.email=release@example.invalid',
    'merge',
    '--no-ff',
    '-qm',
    'Merge native change',
    'feature',
  ]);
  const merge = f.git(['rev-parse', 'HEAD']);
  const candidate = f.commitFile('web.txt', 'Next web change\n');
  f.git(['update-ref', 'refs/remotes/origin/main', candidate]);
  process.env.RELEASE_COMMIT = candidate;
  f.runs['ci.yml'] = [successRun(candidate, 3)];
  f.runs['audio.yml'] = [successRun(merge, 4)];
  await f.run();
  expect(JSON.stringify(f.summary)).toContain(merge);
  expect(f.writes).toHaveLength(1);
});

test('accepts native CI on a multi-commit push ending in an unrelated change', async () => {
  const f = fixture();
  f.commitFile(
    'ios/App.xcconfig',
    'MARKETING_VERSION = 1.0\nCURRENT_PROJECT_VERSION = 1\n',
  );
  const pushHead = f.commitFile('web.txt', 'Last change in the same push\n');
  const candidate = f.commitFile('web.txt', 'Later unrelated web change\n');
  f.git(['update-ref', 'refs/remotes/origin/main', candidate]);
  process.env.RELEASE_COMMIT = candidate;
  f.runs['ci.yml'] = [successRun(candidate, 5)];
  f.runs['audio.yml'] = [
    successRun(pushHead, 4),
    successRun(f.nativeCommit, 2),
  ];
  await f.run();
  expect(JSON.stringify(f.summary)).toContain(pushHead);
  expect(f.writes).toHaveLength(1);
});

test('cannot inherit old native CI after a native source change', async () => {
  const f = fixture();
  const candidate = f.commitFile(
    'ios/App.xcconfig',
    'MARKETING_VERSION = 1.0\nCURRENT_PROJECT_VERSION = 1\n',
  );
  f.git(['update-ref', 'refs/remotes/origin/main', candidate]);
  process.env.RELEASE_COMMIT = candidate;
  f.runs['ci.yml'] = [successRun(candidate, 3)];
  await expect(f.run()).rejects.toThrow('No main-push Native audio run');
  expect(f.writes).toHaveLength(0);
});

test('ignores newer native runs for commits beyond the selected candidate', async () => {
  const f = fixture();
  const newer = f.commitFile('web.txt', 'Future change\n');
  f.git(['update-ref', 'refs/remotes/origin/main', newer]);
  f.runs['audio.yml'] = [
    { ...successRun(newer, 3), conclusion: 'failure' },
    successRun(f.nativeCommit, 2),
  ];
  await f.run();
  expect(JSON.stringify(f.summary)).toContain(f.nativeCommit);
  expect(f.writes).toHaveLength(1);
});
