import { randomBytes, randomInt } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authSecret } from '../src/server/auth/backend';
import { isCode, isEmail } from '../src/server/auth/http';
import {
  normalizeEmailIdentity,
  reviewCodeDigest,
} from '../src/server/auth/review-credential';
import {
  ArtifactError,
  digest,
  protectedExternalPath,
  readProtected,
  writeProtected,
} from './lib/artifacts';
import { DatabaseTargetError, openDatabase } from './lib/database';
import {
  applyReviewAccount,
  inspectReviewOperation,
  planReviewAccount,
  ReviewAccountError,
  type ReviewAction,
  type ReviewIdentity,
  type ReviewPlan,
} from './lib/review-account';
import { resolveReviewSeed, reviewHttpsUrl } from './lib/review-assets';
import { verifyReviewAccount } from './lib/review-verify';
import { validateInventory } from './schema-catalog';

interface Configuration extends ReviewIdentity {
  apiOrigin: string;
  feeds: { public: string; private: string };
}

const root = new URL('../', import.meta.url);
const limit = 16 * 1024 * 1024;
const usage =
  'Usage: review-account.ts credential|sampler-token|plan|apply|verify|inspect --config FILE [command options]';

export function reviewArguments(args: string[]) {
  const [command, ...rest] = args;
  const required: Record<string, string[]> = {
    credential: ['config', 'output'],
    'sampler-token': ['output'],
    plan: ['config', 'action', 'submission', 'reference', 'output'],
    apply: ['config', 'plan', 'target', 'output'],
    verify: ['config', 'plan', 'credential', 'output'],
    inspect: ['plan', 'target'],
  };
  const optional: Record<string, string[]> = {
    plan: ['credential'],
    apply: ['credential'],
    verify: ['skip-send'],
  };
  if (!required[command]) throw new ReviewAccountError(usage);
  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index].replace(/^--/, '');
    if (
      rest[index] !== `--${key}` ||
      !(required[command].includes(key) || optional[command]?.includes(key)) ||
      Object.hasOwn(options, key)
    )
      throw new ReviewAccountError(
        'Unknown or duplicate review-account option',
      );
    const value = key === 'skip-send' ? 'true' : rest[++index];
    if (!value || value.startsWith('--'))
      throw new ReviewAccountError('Missing review-account option value');
    options[key] = value;
  }
  if (required[command].some((key) => !options[key]))
    throw new ReviewAccountError(usage);
  return { command, options };
}

function protectedFile(path: string) {
  const destination = protectedExternalPath(path, root);
  const git = Bun.spawnSync(
    ['git', '-C', dirname(destination), 'rev-parse', '--show-toplevel'],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  if (git.exitCode === 0)
    throw new ReviewAccountError(
      'Protected files must be outside every Git checkout',
    );
  return destination;
}

function configuration(path: string): Configuration {
  const config = readProtected(protectedFile(path), 16_384) as Configuration;
  if (
    !['apple', 'google'].includes(config.store) ||
    !['production', 'development'].includes(config.target) ||
    !isEmail(config.email) ||
    normalizeEmailIdentity(config.email) !== config.email ||
    !config.feeds
  )
    throw new ReviewAccountError('Invalid review account configuration');
  const origin = reviewHttpsUrl(`${config.apiOrigin}/`);
  if (origin.origin !== config.apiOrigin)
    throw new ReviewAccountError(
      'API origin must contain only scheme and host',
    );
  reviewHttpsUrl(config.feeds.public);
  reviewHttpsUrl(config.feeds.private);
  return config;
}

export function reviewSourceDigest(config: unknown) {
  const files: { path: string; digest: string }[] = [];
  const collect = (path: string) => {
    const absolute = fileURLToPath(new URL(path, root));
    if (lstatSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute).sort())
        collect(`${path}/${name}`);
    } else
      files.push({
        path,
        digest: digest(readFileSync(absolute).toString('base64')),
      });
  };
  for (const path of [
    'src',
    'scripts',
    'migrations/active',
    'contracts',
    'public/samples/review',
    'package.json',
    'yarn.lock',
  ])
    collect(path);
  return digest({ files, config });
}

function credential(path: string, identity: ReviewIdentity) {
  const value = readProtected(protectedFile(path), 16_384);
  if (
    value.store !== identity.store ||
    value.email !== identity.email ||
    !isCode(value.code)
  )
    throw new ReviewAccountError(
      'Credential does not match the enrolled store and email',
    );
  return value.code as string;
}

async function main(args: string[]) {
  const { command, options } = reviewArguments(args);
  const output = options.output ? protectedFile(options.output) : null;
  if (output && lstatSync(output, { throwIfNoEntry: false }))
    throw new ReviewAccountError('Output exists; select a new protected file');
  if (command === 'sampler-token') {
    writeProtected(output ?? '', { token: randomBytes(32).toString('hex') });
    console.log('Sampler token saved to the protected file');
    return;
  }
  const config = options.config ? configuration(options.config) : null;
  if (command === 'credential' && config) {
    writeProtected(output ?? '', {
      store: config.store,
      email: config.email,
      code: randomInt(0, 1_000_000).toString().padStart(6, '0'),
    });
    console.log('Review credential saved to the protected file');
    return;
  }
  const sql = openDatabase('REVIEW_DATABASE_URL');
  try {
    const plan = options.plan
      ? (readProtected(protectedFile(options.plan), limit) as ReviewPlan)
      : null;
    if (command === 'inspect' && plan) {
      if (options.target !== plan.identity.target)
        throw new ReviewAccountError('Explicit target does not match the plan');
      const receipt = await inspectReviewOperation(sql, plan);
      console.log(
        JSON.stringify({
          status: receipt ? 'committed' : 'not_current',
          operationId: plan.operationId,
        }),
      );
      return;
    }
    if (!config) throw new ReviewAccountError('Configuration required');
    const identity = {
      store: config.store,
      email: config.email,
      target: config.target,
    };
    const sourceDigest = reviewSourceDigest(config);
    const code = options.credential
      ? credential(options.credential, identity)
      : null;
    const credentialDigest = code
      ? reviewCodeDigest(authSecret(), config.store, config.email, code)
      : null;
    if (command === 'plan') {
      if (!['create', 'reset', 'rotate', 'remove'].includes(options.action))
        throw new ReviewAccountError('Invalid preparation action');
      const action = options.action as ReviewAction;
      const seed = ['create', 'reset'].includes(action)
        ? await resolveReviewSeed(config.feeds)
        : null;
      const reference = validateInventory(
        readProtected(protectedFile(options.reference), limit),
      );
      const result = await planReviewAccount(
        sql,
        {
          identity,
          action,
          submission: options.submission,
          sourceDigest,
          credentialDigest,
        },
        reference,
        seed,
      );
      writeProtected(output ?? '', result, limit);
      console.log(
        JSON.stringify({
          action,
          store: config.store,
          operationId: result.operationId,
          affectedRows: result.account.rows,
          rotatesCode: credentialDigest !== null,
        }),
      );
      return;
    }
    if (!plan || digest(identity) !== digest(plan.identity))
      throw new ReviewAccountError('Configuration does not match the plan');
    if (command === 'apply') {
      if (options.target !== config.target)
        throw new ReviewAccountError(
          'Explicit target does not match configuration',
        );
      const committed = await inspectReviewOperation(sql, plan);
      const result =
        committed ??
        (await applyReviewAccount(sql, plan, {
          sourceDigest,
          credentialDigest,
          target: config.target,
          seed: plan.seed ? await resolveReviewSeed(config.feeds) : null,
        }));
      writeProtected(output ?? '', result, limit);
      console.log(
        JSON.stringify({
          status: 'committed',
          store: config.store,
          operationId: plan.operationId,
          action: plan.action,
        }),
      );
    } else if (command === 'verify') {
      if (!code || sourceDigest !== plan.sourceDigest)
        throw new ReviewAccountError(
          'Verification needs the pinned source, configuration and credential',
        );
      if (
        plan.seed &&
        digest(await resolveReviewSeed(config.feeds)) !== plan.seed.digest
      )
        throw new ReviewAccountError('Seed changed since preparation');
      const result = await verifyReviewAccount(
        sql,
        plan,
        config.apiOrigin,
        code,
        { sendCode: !options['skip-send'] },
      );
      writeProtected(output ?? '', result, limit);
      console.log(
        JSON.stringify({
          status: 'verified',
          operationId: plan.operationId,
          codeRequestChecked: result.codeRequestChecked,
          seedChecked: result.seedChecked,
        }),
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof ReviewAccountError ||
        error instanceof ArtifactError ||
        error instanceof DatabaseTargetError
        ? error.message
        : 'Review account operation failed; inspect the committed receipt before retrying',
    );
    process.exitCode = 1;
  });
