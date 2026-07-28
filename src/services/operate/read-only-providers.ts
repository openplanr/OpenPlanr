import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseStrictJson } from './evidence-import.js';
import { OperateError } from './types.js';

const execFileAsync = promisify(execFile);
const MAX_PROVIDER_OUTPUT = 5 * 1024 * 1024;
const DEFAULT_REMOTE_TIMEOUT_MS = 20_000;
const DEFAULT_REMOTE_MAX_BYTES = 5 * 1024 * 1024;
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'] as const;

function minimalEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return { ...environment, ...extra };
}

const GIT_READ_COMMANDS = new Set([
  'diff',
  'log',
  'show',
  'status',
  'tag',
  'rev-parse',
  'ls-files',
  'branch',
]);

export function assertGitReadOnlyArgs(args: readonly string[]): void {
  const forbiddenRepositoryOverrides = [
    '-C',
    '-c',
    '--git-dir',
    '--work-tree',
    '--namespace',
    '--exec-path',
    '--config-env',
  ];
  if (
    args.some((argument) =>
      forbiddenRepositoryOverrides.some(
        (option) => argument === option || argument.startsWith(`${option}=`),
      ),
    )
  ) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      'Git repository and configuration overrides are forbidden for evidence.',
    );
  }
  const command = args.find((argument) => !argument.startsWith('-'));
  if (!command || !GIT_READ_COMMANDS.has(command)) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `Git operation is not allowlisted for evidence: ${command ?? '(missing)'}.`,
    );
  }
  const forbidden = new Set([
    'commit',
    'checkout',
    'switch',
    'reset',
    'clean',
    'push',
    'pull',
    'fetch',
    'merge',
    'rebase',
    'cherry-pick',
    'apply',
    'am',
    'gc',
    'config',
    'remote',
  ]);
  if (args.some((argument) => forbidden.has(argument))) {
    throw new OperateError('E_OPERATE_PROVIDER_READ_ONLY', 'Git mutation is forbidden.');
  }
}

export async function executeGitReadOnly(
  projectRoot: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<string> {
  assertGitReadOnlyArgs(args);
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectRoot,
    env: minimalEnvironment(),
    maxBuffer: MAX_PROVIDER_OUTPUT,
    timeout: Math.max(1, Math.min(options.timeoutMs ?? 15_000, 15_000)),
  });
  return stdout;
}

const GH_READ_COMMANDS: Record<string, Set<string>> = {
  issue: new Set(['list', 'view']),
  pr: new Set(['list', 'view', 'checks']),
  release: new Set(['list', 'view']),
  run: new Set(['list', 'view']),
  repo: new Set(['view']),
  auth: new Set(['status', 'token']),
};

export function assertGitHubReadOnlyArgs(args: readonly string[]): void {
  const [resource, action] = args;
  if (!resource || !action || !GH_READ_COMMANDS[resource]?.has(action)) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `GitHub operation is not allowlisted for evidence: ${resource ?? ''} ${action ?? ''}`.trim(),
    );
  }
  if (args.includes('--web') || args.includes('--jq') || args.includes('--template')) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      'GitHub evidence cannot open browsers or execute output templates.',
    );
  }
}

export async function executeGitHubReadOnly(
  projectRoot: string,
  args: string[],
  options: { allowedHosts?: string[]; timeoutMs?: number } = {},
): Promise<string> {
  assertGitHubReadOnlyArgs(args);
  const host = process.env.GH_HOST ?? 'github.com';
  const allowedHosts = options.allowedHosts ?? ['github.com'];
  if (!allowedHosts.includes(host)) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `GitHub host ${host} is not allowlisted.`,
    );
  }
  const { stdout } = await execFileAsync('gh', args, {
    cwd: projectRoot,
    env: minimalEnvironment({ GH_HOST: host, GH_PROMPT_DISABLED: '1' }),
    maxBuffer: MAX_PROVIDER_OUTPUT,
    timeout: Math.max(1, Math.min(options.timeoutMs ?? 20_000, 20_000)),
  });
  return stdout;
}

export type ReadOnlyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface BoundedRemoteRequestOptions {
  allowedHosts: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: ReadOnlyFetch;
}

function normalizedAllowedHosts(hosts: readonly string[]): Set<string> {
  return new Set(hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
}

export function assertReadOnlyRestRequest(
  endpoint: string | URL,
  method: string,
  allowedHosts: readonly string[],
): URL {
  const url = new URL(endpoint);
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `Remote evidence permits GET and HEAD only, not ${normalizedMethod}.`,
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !normalizedAllowedHosts(allowedHosts).has(url.hostname.toLowerCase())
  ) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `Remote evidence host is not allowlisted: ${url.hostname || '(missing)'}.`,
    );
  }
  return url;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      'Remote evidence limits must be positive integers.',
    );
  }
  return Math.min(value, maximum);
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      'Remote evidence redirects are forbidden.',
    );
  }
  if (!response.ok) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `Remote evidence request failed with HTTP ${response.status}.`,
    );
  }
  const rawLength = response.headers.get('content-length');
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength) || Number(rawLength) > maxBytes) {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        'Remote evidence Content-Length is invalid or exceeds the configured limit.',
      );
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader
          .cancel('OpenPlanr remote evidence byte limit exceeded.')
          .catch(() => undefined);
        throw new OperateError(
          'E_OPERATE_EVIDENCE_REJECTED',
          'Remote evidence streamed response exceeds the configured byte limit.',
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    bytes,
  );
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(merged);
  } catch {
    throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Remote evidence is not valid UTF-8.');
  }
}

async function fetchBoundedJson<T>(
  endpoint: URL,
  init: RequestInit,
  options: BoundedRemoteRequestOptions,
): Promise<T> {
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, DEFAULT_REMOTE_TIMEOUT_MS, 60_000);
  const maxBytes = boundedPositiveInteger(
    options.maxBytes,
    DEFAULT_REMOTE_MAX_BYTES,
    DEFAULT_REMOTE_MAX_BYTES,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new OperateError(
        'E_OPERATE_PROVIDER_READ_ONLY',
        'Remote evidence redirects are forbidden.',
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (
      response.status !== 204 &&
      contentType &&
      !/(?:application\/json|\+json)\b/i.test(contentType)
    ) {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        'Remote evidence response is not JSON.',
      );
    }
    const body = await readBoundedResponseText(response, maxBytes);
    if (!body && response.status === 204) return null as T;
    try {
      return parseStrictJson(body, {
        maxBytes,
        maxDepth: 64,
        maxScalars: 100_000,
        maxStringLength: maxBytes,
      }) as T;
    } catch (error) {
      if (error instanceof OperateError) throw error;
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        'Remote evidence response contains malformed JSON.',
      );
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        `Remote evidence request exceeded the ${timeoutMs}ms timeout.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeRestReadOnlyJson<T>(
  endpoint: string | URL,
  options: BoundedRemoteRequestOptions & {
    method?: 'GET' | 'HEAD';
    headers?: Readonly<Record<string, string>>;
  },
): Promise<T> {
  const method = options.method ?? 'GET';
  const url = assertReadOnlyRestRequest(endpoint, method, options.allowedHosts);
  return fetchBoundedJson<T>(
    url,
    {
      method,
      headers: options.headers,
    },
    options,
  );
}

function stripGraphqlComments(query: string): string {
  return query.replace(/#[^\r\n]*/g, '').trim();
}

export function assertLinearReadOnlyQuery(endpoint: string, query: string): void {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.linear.app' ||
    url.pathname !== '/graphql' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    url.search ||
    url.hash
  ) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      'Linear evidence endpoint must be https://api.linear.app/graphql.',
    );
  }
  const normalized = stripGraphqlComments(query);
  if (
    /\b(?:mutation|subscription)\b/i.test(normalized) ||
    (!normalized.startsWith('query') && !normalized.startsWith('{'))
  ) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      'Linear evidence permits GraphQL query operations only.',
    );
  }
}

export interface LinearQueryTransport {
  readonly endpoint: string;
  query<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T>;
}

export class ReadOnlyLinearTransport {
  constructor(private readonly transport: LinearQueryTransport) {}

  async query<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T> {
    assertLinearReadOnlyQuery(this.transport.endpoint, query);
    return this.transport.query<T>(query, variables);
  }
}

export async function executeLinearReadOnlyQuery<T>(
  input: BoundedRemoteRequestOptions & {
    endpoint?: string;
    token: string;
    query: string;
    variables?: Readonly<Record<string, unknown>>;
  },
): Promise<T> {
  const endpoint = input.endpoint ?? 'https://api.linear.app/graphql';
  assertLinearReadOnlyQuery(endpoint, input.query);
  if (!input.token.trim()) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      'Linear evidence credentials are unavailable.',
    );
  }
  const requestBody = JSON.stringify({
    query: input.query,
    variables: input.variables ?? {},
  });
  if (Buffer.byteLength(requestBody) > 256 * 1024) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      'Linear evidence query exceeds the request-size limit.',
    );
  }
  const response = await fetchBoundedJson<{
    data?: T;
    errors?: Array<{ message?: string }>;
  }>(
    new URL(endpoint),
    {
      method: 'POST',
      headers: {
        authorization: input.token,
        'content-type': 'application/json',
      },
      body: requestBody,
    },
    input,
  );
  if (response.errors?.length || response.data === undefined) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      'Linear evidence query returned a GraphQL error.',
    );
  }
  return response.data;
}
