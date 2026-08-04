import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseStrictJson } from './evidence-import.js';
import { minimalSubprocessEnvironment } from './subprocess-env.js';
import { OperateError } from './types.js';

const execFileAsync = promisify(execFile);
const MAX_PROVIDER_OUTPUT = 5 * 1024 * 1024;
const DEFAULT_REMOTE_TIMEOUT_MS = 20_000;
const DEFAULT_REMOTE_MAX_BYTES = 5 * 1024 * 1024;
function minimalEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return minimalSubprocessEnvironment(extra);
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

const GIT_CITATION_REVISION_PATTERN = /^[A-Fa-f0-9]{7,64}$/;
// Mirrors the `operating-citation@1.4.0` repository-path shape: a bounded,
// traversal-free, repository-relative path. A leading dot IS permitted so the
// dot-prefixed roots every advisor mandate authorizes (`.github/`, `.planr/`,
// `.changeset/`, …) are readable; only a `..` traversal segment stays forbidden.
const GIT_CITATION_PATH_PATTERN = /^(?!.*\.\.)[A-Za-z0-9.][A-Za-z0-9._/-]*$/;
// The `.planr/` control-artifact surface is dot-prefixed, so citation-by-artifact
// reads validate against a distinct, still-bounded `.planr`-rooted pattern.
const PLANR_CITATION_PATH_PATTERN = /^\.planr(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_CITATION_SNAPSHOT_BYTES = 1024 * 1024;

export function assertGitCitationRevision(revision: string): void {
  if (typeof revision !== 'string' || !GIT_CITATION_REVISION_PATTERN.test(revision)) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `Git citation revision must be a bounded hex object name: ${revision ?? '(missing)'}.`,
    );
  }
}

// Exported so the cross-component conformance suite can assert this git-read-layer
// path validator and the record-time citation anchor accept/reject an identical
// probe set — the two v1.3-pattern copies that once drifted apart must not again.
export function assertGitCitationRepositoryPath(relativePath: string): void {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > 1024 ||
    relativePath.startsWith('/') ||
    !GIT_CITATION_PATH_PATTERN.test(relativePath)
  ) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `Git citation path must be a bounded repository-relative path: ${relativePath ?? '(missing)'}.`,
    );
  }
}

function assertGitPlanrCitationPath(relativePath: string): void {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.length > 1024 ||
    relativePath.startsWith('/') ||
    relativePath.includes('..') ||
    !PLANR_CITATION_PATH_PATTERN.test(relativePath)
  ) {
    throw new OperateError(
      'E_OPERATE_PROVIDER_READ_ONLY',
      `Planr citation path must be a bounded .planr-relative path: ${relativePath ?? '(missing)'}.`,
    );
  }
}

function countTextLines(content: string): number {
  if (content.length === 0) return 0;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
}

export interface GitCitationBlob {
  exists: boolean;
  content: string | null;
  lineCount: number;
}

async function readGitBlob(
  projectRoot: string,
  revision: string,
  gitPath: string,
  options: { maxBytes?: number; timeoutMs?: number },
): Promise<GitCitationBlob> {
  const maxBytes = Math.max(
    1,
    Math.min(options.maxBytes ?? MAX_CITATION_SNAPSHOT_BYTES, MAX_PROVIDER_OUTPUT),
  );
  // `<revision>:<path>` is a single object-name token; the revision and path are
  // pattern-validated above, so neither can inject a leading `-` git option.
  try {
    const stdout = await executeGitReadOnly(projectRoot, ['show', `${revision}:${gitPath}`], {
      timeoutMs: options.timeoutMs,
    });
    if (Buffer.byteLength(stdout, 'utf8') > maxBytes) {
      throw new OperateError(
        'E_OPERATE_EVIDENCE_REJECTED',
        `Cited content ${gitPath} exceeds the ${maxBytes}-byte snapshot bound.`,
      );
    }
    return { exists: true, content: stdout, lineCount: countTextLines(stdout) };
  } catch (error) {
    if (error instanceof OperateError && error.code === 'E_OPERATE_EVIDENCE_REJECTED') throw error;
    // `git show` exits non-zero when the path or revision is absent — a missing
    // citation target, not a provider failure, so the resolver can fail closed.
    return { exists: false, content: null, lineCount: 0 };
  }
}

/**
 * Read one repository-relative file at a pinned revision through the read-only
 * `show` surface for a repository-path citation. Returns `exists: false` when the
 * path is absent at that revision instead of throwing, so a fabricated or drifted
 * citation becomes a fail-closed rejection rather than an error.
 */
export async function readGitPathAtRevision(
  projectRoot: string,
  revision: string,
  relativePath: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<GitCitationBlob> {
  assertGitCitationRevision(revision);
  assertGitCitationRepositoryPath(relativePath);
  return readGitBlob(projectRoot, revision, relativePath, options);
}

/** Read a `.planr/`-rooted control artifact at a pinned revision for a planr-artifact citation. */
export async function readGitPlanrPathAtRevision(
  projectRoot: string,
  revision: string,
  planrPath: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<GitCitationBlob> {
  assertGitCitationRevision(revision);
  assertGitPlanrCitationPath(planrPath);
  return readGitBlob(projectRoot, revision, planrPath, options);
}

function parseGitTreeListing(stdout: string): string[] {
  const entries: string[] = [];
  const lines = stdout.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    // `git show <rev>:<dir>` prefixes the listing with a `tree <rev>:<dir>`
    // header line followed by a blank line; both are skipped here.
    if (index === 0 && /^tree \S+:/.test(lines[index])) continue;
    const name = lines[index].trim();
    if (name) entries.push(name.replace(/\/$/, ''));
  }
  return entries;
}

/**
 * List the immediate entry names of a `.planr/`-rooted tree at a pinned revision.
 * Returns an empty list when the tree is absent, so an unresolved planr-artifact
 * citation fails closed rather than throwing.
 */
export async function listGitPlanrTreeAtRevision(
  projectRoot: string,
  revision: string,
  planrTreePath: string,
  options: { timeoutMs?: number } = {},
): Promise<string[]> {
  assertGitCitationRevision(revision);
  assertGitPlanrCitationPath(planrTreePath);
  try {
    const stdout = await executeGitReadOnly(projectRoot, ['show', `${revision}:${planrTreePath}`], {
      timeoutMs: options.timeoutMs,
    });
    return parseGitTreeListing(stdout);
  } catch {
    return [];
  }
}

/** Whether a cited revision resolves to a commit object, using the read-only rev-parse surface. */
export async function gitRevisionResolves(
  projectRoot: string,
  revision: string,
  options: { timeoutMs?: number } = {},
): Promise<boolean> {
  assertGitCitationRevision(revision);
  try {
    const stdout = await executeGitReadOnly(
      projectRoot,
      ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
      { timeoutMs: options.timeoutMs },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** A compact, snapshot-safe commit summary (hash, ISO commit date, subject) for a git-revision citation. */
export async function readGitCommitSummary(
  projectRoot: string,
  revision: string,
  options: { timeoutMs?: number } = {},
): Promise<string | null> {
  assertGitCitationRevision(revision);
  try {
    const stdout = await executeGitReadOnly(
      projectRoot,
      ['log', '-1', '--no-color', '--format=%H%n%cI%n%s', revision],
      { timeoutMs: options.timeoutMs },
    );
    return stdout.trim().length > 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
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
