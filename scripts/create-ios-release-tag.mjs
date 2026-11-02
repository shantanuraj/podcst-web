import { execFileSync } from 'node:child_process';

export async function createIOSReleaseTag({
  github,
  context,
  core,
  exec = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim(),
}) {
  const { owner, repo } = context.repo;
  if (
    `${owner}/${repo}` !== 'shantanuraj/podcst-web' ||
    context.ref !== 'refs/heads/main' ||
    context.eventName !== 'workflow_dispatch'
  ) {
    throw new Error('Run this workflow manually from podcst-web main.');
  }

  const commit = process.env.RELEASE_COMMIT ?? '';
  const tag = process.env.RELEASE_TAG ?? '';
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('Supply the full 40-character lowercase commit SHA.');
  }
  const version = tag.match(
    /^ios-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)(?:-rc\.[1-9]\d*)?$/,
  )?.[1];
  if (!version) {
    throw new Error(
      'Use ios-1.0, ios-1.0.1 or a numbered candidate such as ios-1.0-rc.2.',
    );
  }

  if (exec(['rev-parse', '--verify', `${commit}^{commit}`]) !== commit) {
    throw new Error('The candidate must identify a commit.');
  }
  try {
    exec(['merge-base', '--is-ancestor', commit, 'origin/main']);
  } catch {
    throw new Error('The candidate is not on origin/main.');
  }
  const config = exec(['show', `${commit}:ios/App.xcconfig`]);
  const versions = [
    ...config.matchAll(/^\s*MARKETING_VERSION\s*=\s*(.*?)\s*$/gm),
  ];
  if (versions.length !== 1 || versions[0][1] !== version) {
    throw new Error(
      'The tag version must match MARKETING_VERSION in the candidate ios/App.xcconfig.',
    );
  }
  if (/\[ci skip\]/i.test(exec(['show', '-s', '--format=%B', commit]))) {
    throw new Error(
      'The candidate contains [ci skip], which prevents Xcode Cloud builds.',
    );
  }

  const ref = `tags/${tag}`;
  const findTag = async () => {
    try {
      return (await github.rest.git.getRef({ owner, repo, ref })).data;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  };
  const matches = (existing) =>
    existing?.object.type === 'commit' && existing.object.sha === commit;
  const existing = await findTag();
  if (existing && !matches(existing)) {
    throw new Error(
      `${tag} already exists with a different target. Tags are never moved.`,
    );
  }

  const checks = [];
  const requireSuccess = (workflow, run, sha) => {
    if (
      !run ||
      run.head_sha !== sha ||
      run.head_branch !== 'main' ||
      run.event !== 'push' ||
      run.status !== 'completed' ||
      run.conclusion !== 'success'
    ) {
      throw new Error(
        `${workflow} must have a successful latest main-push run for ${sha}. Finish or rerun CI, then try again.`,
      );
    }
    checks.push([workflow, sha, run.html_url]);
  };
  const ci = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: 'ci.yml',
    head_sha: commit,
    branch: 'main',
    event: 'push',
    per_page: 1,
  });
  requireSuccess('ci.yml', ci.data.workflow_runs[0], commit);

  let nativeRun;
  for (let page = 1; page <= 3 && !nativeRun; page++) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: 'audio.yml',
      branch: 'main',
      event: 'push',
      per_page: 100,
      page,
    });
    for (const run of data.workflow_runs) {
      if (
        !/^[0-9a-f]{40}$/.test(run.head_sha) ||
        run.head_branch !== 'main' ||
        run.event !== 'push'
      )
        continue;
      try {
        exec(['merge-base', '--is-ancestor', run.head_sha, commit]);
        exec([
          'diff',
          '--quiet',
          run.head_sha,
          commit,
          '--',
          'ios',
          'audio-engine',
          'contracts',
          '.github/workflows/audio.yml',
        ]);
      } catch {
        continue;
      }
      nativeRun = run;
      break;
    }
    if (data.workflow_runs.length < 100) break;
  }
  if (!nativeRun)
    throw new Error(
      'No main-push Native audio run with unchanged native sources was found in the latest 300 runs. Push the native changes to main and wait for CI, or rerun an existing matching Native audio check.',
    );
  requireSuccess('audio.yml', nativeRun, nativeRun.head_sha);

  let created = false;
  if (!existing) {
    try {
      await github.rest.git.createRef({
        owner,
        repo,
        ref: `refs/${ref}`,
        sha: commit,
      });
      created = true;
    } catch (error) {
      if (!matches(await findTag())) throw error;
    }
  }

  core.setOutput('tag', tag);
  core.setOutput('commit', commit);
  core.setOutput('created', created);
  await core.summary
    .addHeading('iOS release tag')
    .addRaw(
      `**${tag}** → \`${commit}\`\n\n${created ? 'Created the release tag.' : 'The tag already exists at this commit; no new tag event was sent. Start or rerun the build in Xcode Cloud if needed.'}\n\nRequested by @${context.actor} · [GitHub Actions run](https://github.com/${owner}/${repo}/actions/runs/${context.runId})\n\n`,
    )
    .addTable([['Workflow', 'Verified commit', 'Run'], ...checks])
    .addRaw(
      '\nVerify that the Xcode Cloud Release workflow starts for this tag and that Apple processes the archive. Creating a tag does not submit or release the app.\n',
    )
    .write();
  return { tag, commit, created };
}
