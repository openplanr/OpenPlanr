#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';
const LINEAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/u;

export class IntegrationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.details = details;
  }
}

export function isLikelyLinearIssueId(value) {
  return typeof value === 'string'
    && (LINEAR_UUID.test(value.trim()) || LINEAR_IDENTIFIER.test(value.trim()));
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

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    throw new IntegrationError('E_INTEGRATION_COMMAND', `${command} ${args.join(' ')} failed.`, {
      command,
      args,
      stderr: typeof error?.stderr === 'string' ? error.stderr.trim() : undefined,
    });
  }
}

export async function inspectGitHub({ cwd = process.cwd() } = {}) {
  const { stdout } = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,url'], cwd);
  return { provider: 'github', repository: JSON.parse(stdout) };
}

export async function executeGitHubOperations(operations, { cwd = process.cwd(), apply = false } = {}) {
  if (!Array.isArray(operations)) throw new IntegrationError('E_SYNC_INPUT', 'GitHub operations must be an array.');
  if (!apply) return { provider: 'github', applied: false, operations };
  const results = [];
  for (const operation of operations) {
    if (operation.action === 'create') {
      const args = ['issue', 'create', '--title', String(operation.title ?? '')];
      if (operation.body !== undefined) args.push('--body', String(operation.body));
      for (const label of operation.labels ?? []) args.push('--label', label);
      const { stdout } = await run('gh', args, cwd);
      results.push({ action: 'create', url: stdout.trim() });
      continue;
    }
    if (operation.action === 'update' && operation.id) {
      const args = ['issue', 'edit', String(operation.id)];
      if (operation.title !== undefined) args.push('--title', operation.title);
      if (operation.body !== undefined) args.push('--body', operation.body);
      for (const label of operation.labels ?? []) args.push('--add-label', label);
      await run('gh', args, cwd);
      results.push({ action: 'update', id: String(operation.id) });
      continue;
    }
    throw new IntegrationError('E_SYNC_OPERATION', 'Unsupported GitHub synchronization operation.', { operation });
  }
  return { provider: 'github', applied: true, results };
}

async function linearRequest(query, variables, token, fetchImpl = fetch) {
  if (!token) throw new IntegrationError('E_LINEAR_CREDENTIAL', 'Linear credentials are unavailable.');
  let response;
  let payload;
  try {
    response = await fetchImpl(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    payload = await response.json();
  } catch (error) {
    throw new IntegrationError('E_LINEAR_API', 'Linear synchronization transport failed.', {
      cause: String(error?.message ?? error),
    });
  }
  if (!response.ok || !payload || typeof payload !== 'object' || payload.errors?.length) {
    throw new IntegrationError('E_LINEAR_API', 'Linear rejected the synchronization request.', {
      status: response.status,
      errors: payload?.errors,
    });
  }
  return payload.data;
}

function requireLinearMutationResult(data, field) {
  const result = data?.[field];
  const issue = result?.issue;
  if (
    result?.success !== true
    || !issue
    || typeof issue.id !== 'string'
    || typeof issue.identifier !== 'string'
    || typeof issue.url !== 'string'
  ) {
    throw new IntegrationError('E_LINEAR_API', `Linear ${field} did not confirm a successful issue mutation.`, {
      field,
      success: result?.success ?? null,
    });
  }
  return issue;
}

export async function inspectLinear({ token = process.env.PLANR_LINEAR_TOKEN } = {}) {
  const data = await linearRequest('query OpenPlanrViewer { viewer { id name email } }', {}, token);
  return { provider: 'linear', viewer: data.viewer };
}

export async function executeLinearOperations(
  operations,
  { token = process.env.PLANR_LINEAR_TOKEN, apply = false } = {},
) {
  if (!Array.isArray(operations)) throw new IntegrationError('E_SYNC_INPUT', 'Linear operations must be an array.');
  if (!apply) return { provider: 'linear', applied: false, operations };
  const results = [];
  for (const operation of operations) {
    if (operation.action === 'create' && operation.teamId) {
      const data = await linearRequest(
        'mutation OpenPlanrCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }',
        { input: { teamId: operation.teamId, title: operation.title, description: operation.body } },
        token,
      );
      results.push({ action: 'create', ...requireLinearMutationResult(data, 'issueCreate') });
      continue;
    }
    if (operation.action === 'update' && isLikelyLinearIssueId(operation.id)) {
      const data = await linearRequest(
        'mutation OpenPlanrUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier url } } }',
        { id: operation.id, input: { title: operation.title, description: operation.body, stateId: operation.state } },
        token,
      );
      results.push({ action: 'update', ...requireLinearMutationResult(data, 'issueUpdate') });
      continue;
    }
    throw new IntegrationError('E_SYNC_OPERATION', 'Unsupported Linear synchronization operation.', { operation });
  }
  return { provider: 'linear', applied: true, results };
}

async function readJsonInput(value, stdin) {
  if (value) return JSON.parse(await readFile(resolve(value), 'utf8'));
  let bytes = '';
  for await (const chunk of stdin) bytes += chunk;
  return JSON.parse(bytes || '[]');
}

async function inspectLocal(cwd) {
  const candidates = ['.planr/config.json', '.openplanr/config.json'];
  const roots = [];
  for (const candidate of candidates) {
    try {
      await access(resolve(cwd, candidate));
      roots.push(candidate.split('/')[0]);
    } catch {
      // A project can use either supported planning root.
    }
  }
  return { provider: 'local', roots, configured: roots.length > 0 };
}

function parseArgs(argv) {
  const [provider = 'local', action = 'inspect', ...rest] = argv;
  const apply = rest.includes('--apply');
  const inputIndex = rest.indexOf('--input');
  return { provider, action, apply, input: inputIndex >= 0 ? rest[inputIndex + 1] : undefined };
}

export async function runPortableSync(
  argv = process.argv.slice(2),
  { cwd = process.cwd(), env = process.env, stdin = process.stdin, stdout = process.stdout } = {},
) {
  const args = parseArgs(argv);
  let result;
  if (args.provider === 'local' && args.action === 'inspect') result = await inspectLocal(cwd);
  else if (args.provider === 'github' && args.action === 'inspect') result = await inspectGitHub({ cwd });
  else if (args.provider === 'github' && args.action === 'sync') {
    result = await executeGitHubOperations(await readJsonInput(args.input, stdin), { cwd, apply: args.apply });
  } else if (args.provider === 'linear' && args.action === 'inspect') {
    result = await inspectLinear({ token: env.PLANR_LINEAR_TOKEN });
  } else if (args.provider === 'linear' && args.action === 'sync') {
    result = await executeLinearOperations(await readJsonInput(args.input, stdin), {
      token: env.PLANR_LINEAR_TOKEN,
      apply: args.apply,
    });
  } else {
    throw new IntegrationError(
      'E_SYNC_USAGE',
      'Usage: sync.mjs <local|github|linear> <inspect|sync> [--input path] [--apply]',
    );
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runPortableSync().catch((error) => {
    process.stderr.write(`${error.code ?? 'E_SYNC'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
