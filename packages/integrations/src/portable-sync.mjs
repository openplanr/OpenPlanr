import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PLANNING_FOLDER } from './names.mjs';

const execFileAsync = promisify(execFile);
const LINEAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/u;
const ISSUE_URL = /^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/issues\/(\d+)$/u;
const GH_INSTALL =
  'Install the GitHub CLI from https://cli.github.com, run `gh auth login`, then retry.';
const MAX_OPERATIONS = 200;

/**
 * Environment variables a `gh` child may inherit: locale, home and config directories, proxy and
 * CA settings, Windows system paths, and gh's own host and token variables. Nothing else passes.
 */
export const GH_ENVIRONMENT = Object.freeze([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'USERPROFILE',
  'GH_CONFIG_DIR',
  'GH_HOST',
  'GH_REPO',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
]);

const GH_FIXED_ENVIRONMENT = Object.freeze({
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_SPINNER_DISABLED: '1',
  NO_COLOR: '1',
});

export class IntegrationError extends Error {
  constructor(code, message, { recovery, ...details } = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.recovery = recovery;
    this.details = details;
  }
}

export function isLikelyLinearIssueId(value) {
  return (
    typeof value === 'string' &&
    (LINEAR_UUID.test(value.trim()) || LINEAR_IDENTIFIER.test(value.trim()))
  );
}

export function reconcileStatus({ base, local, remote }, strategy) {
  if (local === remote) {
    return { final: local, side: 'unchanged', conflictDecisions: 0, isTrueConflict: false };
  }
  if (base !== undefined && base === local) {
    return { final: remote, side: 'remote', conflictDecisions: 0, isTrueConflict: false };
  }
  if (base !== undefined && base === remote) {
    return { final: local, side: 'local', conflictDecisions: 0, isTrueConflict: false };
  }
  const remoteWins = strategy === 'remote';
  return {
    final: remoteWins ? remote : local,
    side: remoteWins ? 'remote' : 'local',
    conflictDecisions: 1,
    isTrueConflict: true,
  };
}

/** The allowlisted environment for a `gh` child, built from `env`. */
export function ghEnvironment(env = process.env) {
  const child = {};
  for (const name of GH_ENVIRONMENT) if (env[name] !== undefined) child[name] = env[name];
  return { ...child, ...GH_FIXED_ENVIRONMENT };
}

/** Maps a failed `gh` invocation to a coded `IntegrationError`. */
export function ghFailure(args, error) {
  const command = `gh ${args.slice(0, 2).join(' ')}`;
  if (error?.code === 'ENOENT')
    return new IntegrationError(
      'E_SYNC_TRACKER_GH_MISSING',
      'The GitHub CLI (gh) is not on PATH.',
      {
        recovery: GH_INSTALL,
      },
    );
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
  const lower = stderr.toLowerCase();
  if (lower.includes('auth login') || lower.includes('not logged'))
    return new IntegrationError(
      'E_SYNC_TRACKER_GH_AUTH',
      `${command} failed: gh is not signed in.`,
      {
        recovery: 'Run `gh auth login`, then retry.',
        stderr,
      },
    );
  if (lower.includes('not a git repository'))
    return new IntegrationError(
      'E_SYNC_TRACKER_NOT_A_REPOSITORY',
      `${command} failed: the directory is not a git repository.`,
      { recovery: 'Run the command from a repository with a GitHub remote.', stderr },
    );
  if (lower.includes('no git remotes') || lower.includes('no github remotes'))
    return new IntegrationError(
      'E_SYNC_TRACKER_NO_REMOTE',
      `${command} failed: the repository has no GitHub remote.`,
      { recovery: 'Add a GitHub remote with `git remote add origin <url>`, then retry.', stderr },
    );
  return new IntegrationError(
    'E_SYNC_TRACKER_GH_FAILED',
    `${command} failed${stderr ? `: ${stderr.split('\n', 1)[0]}` : '.'}`,
    { recovery: 'Fix the gh error above, then retry.', stderr },
  );
}

async function runGh(args, { cwd, env }) {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd,
      env: ghEnvironment(env),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    throw ghFailure(args, error);
  }
}

function invalid(index, problem) {
  return new IntegrationError('E_SYNC_TRACKER_INPUT', `Operation ${index}: ${problem}`, {
    recovery:
      'Each operation is {"action":"create","title":...} or {"action":"update|close|reopen","id":...}; see `openplanr sync tracker --help`.',
  });
}

const OPERATION_FIELDS = {
  create: ['title', 'body', 'labels'],
  update: ['id', 'title', 'body', 'labels'],
  close: ['id', 'comment'],
  reopen: ['id', 'comment'],
};

function readId(operation, index) {
  const { id } = operation;
  const text = typeof id === 'number' ? String(id) : id;
  if (typeof text !== 'string' || !(/^[1-9]\d*$/u.test(text) || ISSUE_URL.test(text)))
    throw invalid(index, '"id" must be an issue number or an issue URL.');
  return text;
}

function readString(operation, key, index) {
  if (!(key in operation)) return {};
  if (typeof operation[key] !== 'string') throw invalid(index, `"${key}" must be a string.`);
  return { [key]: operation[key] };
}

function readLabels(operation, index) {
  if (!('labels' in operation)) return {};
  const { labels } = operation;
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string' || !label.trim()))
    throw invalid(index, '"labels" must be an array of non-empty strings.');
  return { labels };
}

const NORMALIZE = {
  create(operation, index) {
    const { title } = readString(operation, 'title', index);
    if (!title?.trim()) throw invalid(index, 'create needs a non-empty "title".');
    return {
      action: 'create',
      title,
      ...readString(operation, 'body', index),
      ...readLabels(operation, index),
    };
  },
  update(operation, index) {
    const changes = {
      ...readString(operation, 'title', index),
      ...readString(operation, 'body', index),
      ...readLabels(operation, index),
    };
    if (Object.keys(changes).length === 0)
      throw invalid(index, 'update needs at least one of "title", "body" or "labels".');
    return { action: 'update', id: readId(operation, index), ...changes };
  },
  close: (operation, index) => ({
    action: 'close',
    id: readId(operation, index),
    ...readString(operation, 'comment', index),
  }),
  reopen: (operation, index) => ({
    action: 'reopen',
    id: readId(operation, index),
    ...readString(operation, 'comment', index),
  }),
};

function normalizeOperation(operation, index) {
  if (operation === null || typeof operation !== 'object' || Array.isArray(operation))
    throw invalid(index, 'must be an object.');
  const fields = OPERATION_FIELDS[operation.action];
  if (!fields)
    throw invalid(
      index,
      `unknown action ${JSON.stringify(operation.action)}; expected create, update, close or reopen.`,
    );
  const unknown = Object.keys(operation).filter((key) => key !== 'action' && !fields.includes(key));
  if (unknown.length)
    throw invalid(index, `${operation.action} does not take ${unknown.join(', ')}.`);
  return NORMALIZE[operation.action](operation, index);
}

/** Refuses issue URLs outside the repository `gh` resolves; runs `gh` only when a URL is present. */
async function assertSameRepository(batch, { cwd, env }) {
  if (!batch.some(({ id }) => id !== undefined && ISSUE_URL.test(id))) return;
  const { repository } = await inspectGitHub({ cwd, env });
  const home = typeof repository?.url === 'string' ? repository.url.replace(/\/+$/u, '') : '';
  if (!home)
    throw new IntegrationError(
      'E_SYNC_TRACKER_GH_FAILED',
      'gh repo view returned no repository URL.',
      {
        recovery: 'Run `gh repo view --json nameWithOwner,url` to see what gh resolves.',
      },
    );
  for (const [index, { id }] of batch.entries()) {
    if (id === undefined || !ISSUE_URL.test(id)) continue;
    if (!id.toLowerCase().startsWith(`${home.toLowerCase()}/issues/`))
      throw new IntegrationError(
        'E_SYNC_TRACKER_FOREIGN_ISSUE',
        `Operation ${index}: ${id} is not an issue in ${repository.nameWithOwner ?? home}, the repository gh resolves here.`,
        {
          recovery:
            'Use the issue number, or run the command from the repository that owns the issue.',
        },
      );
  }
}

/** Validates a GitHub operation batch and returns the normalized operations, or throws `E_SYNC_TRACKER_INPUT`. */
export function validateGitHubOperations(operations) {
  if (!Array.isArray(operations))
    throw new IntegrationError('E_SYNC_TRACKER_INPUT', 'GitHub operations must be a JSON array.', {
      recovery: 'Pass an array of operations; see `openplanr sync tracker --help`.',
    });
  if (operations.length > MAX_OPERATIONS)
    throw new IntegrationError(
      'E_SYNC_TRACKER_INPUT',
      `${operations.length} operations exceed the limit of ${MAX_OPERATIONS} per run.`,
      { recovery: `Split the batch into runs of at most ${MAX_OPERATIONS}.` },
    );
  return operations.map(normalizeOperation);
}

function ghArguments(operation) {
  const { action, id, title, body, labels = [], comment } = operation;
  if (action === 'create')
    return [
      'issue',
      'create',
      '--title',
      title,
      '--body',
      body ?? '',
      ...labels.flatMap((label) => ['--label', label]),
    ];
  if (action === 'update')
    return [
      'issue',
      'edit',
      id,
      ...(title === undefined ? [] : ['--title', title]),
      ...(body === undefined ? [] : ['--body', body]),
      ...labels.flatMap((label) => ['--add-label', label]),
    ];
  return ['issue', action, id, ...(comment === undefined ? [] : ['--comment', comment])];
}

function appliedResult(operation, stdout) {
  const url = stdout
    .split('\n')
    .find((line) => ISSUE_URL.test(line.trim()))
    ?.trim();
  const id = operation.id ?? (url ? ISSUE_URL.exec(url)[1] : undefined);
  return { ...(id ? { id } : {}), ...(url ? { url } : {}) };
}

/**
 * Previews a batch, or with `apply` runs it in order and stops at the first failure.
 * Every operation gets a result: `planned`, `applied`, `failed` or `not-run`.
 */
export async function executeGitHubOperations(
  operations,
  { cwd = process.cwd(), env = process.env, apply = false } = {},
) {
  const batch = validateGitHubOperations(operations);
  await assertSameRepository(batch, { cwd, env });
  const describe = (operation, index) => ({
    index,
    action: operation.action,
    ...(operation.id ? { id: operation.id } : {}),
    ...(operation.title !== undefined ? { title: operation.title } : {}),
  });
  if (!apply)
    return {
      provider: 'github',
      applied: false,
      complete: true,
      results: batch.map((operation, index) => ({
        ...describe(operation, index),
        status: 'planned',
      })),
    };
  const results = [];
  let failed = false;
  for (const [index, operation] of batch.entries()) {
    if (failed) {
      results.push({ ...describe(operation, index), status: 'not-run' });
      continue;
    }
    try {
      const stdout = await runGh(ghArguments(operation), { cwd, env });
      results.push({
        ...describe(operation, index),
        ...appliedResult(operation, stdout),
        status: 'applied',
      });
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      failed = true;
      results.push({
        ...describe(operation, index),
        status: 'failed',
        error: { code: error.code, problem: error.message, recovery: error.recovery },
      });
    }
  }
  return { provider: 'github', applied: true, complete: !failed, results };
}

/** The GitHub repository `gh` resolves for `cwd`. */
export async function inspectGitHub({ cwd = process.cwd(), env = process.env } = {}) {
  const stdout = await runGh(['repo', 'view', '--json', 'nameWithOwner,url'], { cwd, env });
  let repository;
  try {
    repository = JSON.parse(stdout);
  } catch (error) {
    throw new IntegrationError('E_SYNC_TRACKER_GH_FAILED', 'gh repo view returned invalid JSON.', {
      recovery: 'Run `gh repo view --json nameWithOwner,url` to see what gh prints.',
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return { provider: 'github', repository };
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

/** Which supported planning roots in `cwd` hold a config file. */
export async function inspectLocal({ cwd = process.cwd() } = {}) {
  const roots = [];
  for (const root of [PLANNING_FOLDER, '.openplanr'])
    if (await isFile(resolve(cwd, root, 'config.json'))) roots.push(root);
  return { provider: 'local', roots, configured: roots.length > 0 };
}
