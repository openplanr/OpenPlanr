import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config-service.js';
import { resolveApiKey } from '../credentials-service.js';
import { canonicalDigest, canonicalize } from './canonical.js';
import { createEvidenceDiagnostic } from './evidence-diagnostics.js';
import { readImportedEvidenceFile } from './evidence-import.js';
import { assertOperatingArtifact } from './protocol.js';
import {
  executeGitHubReadOnly,
  executeGitReadOnly,
  executeLinearReadOnlyQuery,
  executeRestReadOnlyJson,
  type ReadOnlyFetch,
} from './read-only-providers.js';
import { compareSensitivity, detectSecretMetadata, sanitizeEvidenceItem } from './redaction.js';
import {
  type CollectedEvidenceItem,
  type EvidenceBudget,
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingDataGap,
  type OperatingEvidence,
  type OperatingEvidenceItem,
  type OperatingSensitivity,
  type OperatingWorkspaceComponent,
  type OperatingWorkspaceManifest,
  type OperatingWorkspaceRoots,
  type RepositoryEvidenceProvenance,
} from './types.js';
import { isPathInside, resolveOperatingPaths } from './workspace.js';

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.css',
  '.csv',
  '.go',
  '.graphql',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

export interface EvidenceCollectionInput {
  projectRoot: string;
  cycleId: string;
  workspace: OperatingWorkspaceManifest;
  providers: string[];
  sensitivityCeiling: OperatingSensitivity;
  budgets: EvidenceBudget;
  localRoot?: string;
  now?: Date;
  /** Standard cycles may reuse an unchanged machine-local evidence snapshot. */
  incremental?: boolean;
  /** Actual runs persist the snapshot; dry-run remains write-free. */
  persistIncremental?: boolean;
  /** Evidence already cited by open findings, decisions, or outcomes. */
  requiredEvidenceRefs?: string[];
  /** Test seam for deterministic remote-provider fixtures. */
  remote?: {
    fetchImpl?: ReadOnlyFetch;
    githubToken?: string;
    linearToken?: string;
  };
}

function evidenceId(source: string, identity: string): string {
  return `EVD-${source}-${canonicalDigest(identity).slice('sha256:'.length, 19)}`;
}

export function evidenceFingerprintItems(items: readonly OperatingEvidenceItem[]): Array<{
  id: string;
  digest: `sha256:${string}`;
  sensitivity: OperatingSensitivity;
}> {
  return items
    .map(({ id, digest, sensitivity }) => ({ id, digest, sensitivity }))
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.digest.localeCompare(right.digest) ||
        left.sensitivity.localeCompare(right.sensitivity),
    );
}

function ageFreshness(collectedAt: string, now: Date, ttlHours = 168): 'fresh' | 'stale' {
  return now.getTime() - Date.parse(collectedAt) <= ttlHours * 60 * 60 * 1_000 ? 'fresh' : 'stale';
}

async function readRoots(
  projectRoot: string,
  localRoot?: string,
): Promise<OperatingWorkspaceRoots> {
  const candidates = [projectRoot, await realpath(projectRoot).catch(() => projectRoot)];
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(
        await readFile(resolveOperatingPaths(candidate, { localRoot }).roots, 'utf8'),
      ) as OperatingWorkspaceRoots;
    } catch {
      // Invocation paths can differ from their canonical real path on systems
      // such as macOS where /var resolves through /private/var.
    }
  }
  throw new OperateError(
    'E_OPERATE_NOT_INITIALIZED',
    'Machine-local workspace roots are missing; run `planr operate init` again.',
  );
}

function descriptorById(
  workspace: OperatingWorkspaceManifest,
): Map<string, OperatingWorkspaceComponent> {
  return new Map(
    [workspace.controlRepository, ...workspace.components].map((entry) => [
      entry.componentId,
      entry,
    ]),
  );
}

async function repositoryItems(
  roots: OperatingWorkspaceRoots,
  workspace: OperatingWorkspaceManifest,
  budgets: EvidenceBudget,
  now: Date,
  options: {
    includeRepository: boolean;
    includePlanr: boolean;
    deadline: number;
  },
): Promise<{ items: CollectedEvidenceItem[]; truncated: boolean }> {
  const descriptors = descriptorById(workspace);
  const results: CollectedEvidenceItem[] = [];
  let files = 0;
  let bytes = 0;
  let truncated = false;
  for (const [componentId, root] of Object.entries(roots.roots).sort()) {
    if (Date.now() >= options.deadline) {
      truncated = true;
      break;
    }
    const descriptor = descriptors.get(componentId);
    if (!descriptor) continue;
    const canonicalRoot = await realpath(root);
    const names = (await executeGitReadOnly(canonicalRoot, ['ls-files', '-z']))
      .split('\0')
      .filter(Boolean)
      .filter((name) => TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort();
    for (const relativePath of names) {
      if (
        Date.now() >= options.deadline ||
        files >= budgets.maxFiles ||
        results.length >= budgets.maxItems
      ) {
        truncated = true;
        break;
      }
      const isPlanr = relativePath.startsWith('.planr/');
      if (
        (!options.includeRepository && !isPlanr) ||
        (isPlanr && !options.includePlanr && !options.includeRepository)
      ) {
        continue;
      }
      const target = path.join(canonicalRoot, relativePath);
      const directInfo = await lstat(target).catch(() => null);
      if (!directInfo) continue;
      const resolvedTarget = await realpath(target).catch(() => null);
      if (!resolvedTarget) continue;
      if (!isPathInside(canonicalRoot, resolvedTarget)) {
        throw new OperateError(
          'E_OPERATE_PATH_ESCAPE',
          `Tracked evidence path follows a symlink outside its repository: ${componentId}/${relativePath}.`,
        );
      }
      if (directInfo.isSymbolicLink()) continue;
      const info = await stat(resolvedTarget).catch(() => null);
      if (!info?.isFile() || info.size > budgets.maxItemBytes) continue;
      if (bytes + info.size > budgets.maxBytes) {
        truncated = true;
        break;
      }
      const content = await readFile(resolvedTarget, 'utf8').catch(() => null);
      if (content === null || content.includes('\0')) continue;
      files += 1;
      bytes += Buffer.byteLength(content);
      const collectedAt = now.toISOString();
      const repository: RepositoryEvidenceProvenance = {
        componentId,
        canonicalRemote: `https://${descriptor.canonicalRemote}`,
        revision: descriptor.pinnedRevision,
        configuredBranch: descriptor.configuredBranch,
        dirtyFingerprint: descriptor.dirtyFingerprint,
        relativePath,
        digest: canonicalDigest(content),
        freshness: ageFreshness(collectedAt, now),
        sensitivity: 'internal',
        collectedAt,
      };
      if (options.includeRepository && results.length < budgets.maxItems) {
        results.push({
          id: evidenceId('repository', `${componentId}:${relativePath}:${repository.digest}`),
          source: 'repository',
          location: `${componentId}/${relativePath}`,
          content,
          collectedAt,
          observedFrom: null,
          observedTo: collectedAt,
          freshness: repository.freshness,
          sensitivity: repository.sensitivity,
          claimTypes: ['code', 'architecture'],
          quality: 'observed',
          coverage: 'partial',
          repository,
        });
      }
      if (isPlanr && options.includePlanr && results.length < budgets.maxItems) {
        const planrClaims = [
          'planning',
          ...(relativePath.includes('/stories/') || relativePath.includes('/specs/')
            ? ['user-journey']
            : []),
          ...(relativePath.includes('outcome') || relativePath.includes('provenance')
            ? ['outcome']
            : []),
          ...(relativePath.includes('/support') ? ['support', 'operations'] : []),
        ];
        results.push({
          id: evidenceId('planr', `${componentId}:${relativePath}:${repository.digest}`),
          source: 'planr',
          location: `${componentId}/${relativePath}`,
          content,
          collectedAt,
          observedFrom: null,
          observedTo: collectedAt,
          freshness: repository.freshness,
          sensitivity: repository.sensitivity,
          claimTypes: planrClaims,
          quality: 'verified',
          coverage: 'partial',
          repository,
        });
      }
    }
  }
  return { items: results, truncated };
}

async function gitItems(
  roots: OperatingWorkspaceRoots,
  workspace: OperatingWorkspaceManifest,
  now: Date,
  deadline: number,
): Promise<{ items: CollectedEvidenceItem[]; truncated: boolean }> {
  const descriptors = descriptorById(workspace);
  const results: CollectedEvidenceItem[] = [];
  for (const [componentId, root] of Object.entries(roots.roots).sort()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { items: results, truncated: true };
    const descriptor = descriptors.get(componentId);
    if (!descriptor) continue;
    // An unborn Git branch has no history to cite. The workspace manifest uses
    // Git's null OID for that state; do not manufacture a change-history item
    // that could incorrectly satisfy an advisor readiness requirement.
    if (/^0{40,64}$/u.test(descriptor.pinnedRevision)) continue;
    const content = await executeGitReadOnly(
      root,
      [
        'log',
        '--since=30.days',
        '--max-count=200',
        '--date=iso-strict',
        '--pretty=format:%H%x09%ad%x09%s',
      ],
      { timeoutMs: remaining },
    );
    const collectedAt = now.toISOString();
    results.push({
      id: evidenceId('git', `${componentId}:${descriptor.pinnedRevision}:${content}`),
      source: 'git',
      location: `${componentId}/history`,
      content,
      collectedAt,
      observedFrom: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString(),
      observedTo: collectedAt,
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: ['change-history'],
      quality: 'verified',
      coverage: 'partial',
      repository: {
        componentId,
        canonicalRemote: `https://${descriptor.canonicalRemote}`,
        revision: descriptor.pinnedRevision,
        configuredBranch: descriptor.configuredBranch,
        dirtyFingerprint: descriptor.dirtyFingerprint,
        relativePath: '.git',
        digest: canonicalDigest(content),
        freshness: 'fresh',
        sensitivity: 'internal',
        collectedAt,
      },
    });
  }
  return { items: results, truncated: false };
}

function boundedRecordsContent(
  key: string,
  records: Array<Record<string, unknown>>,
  maxBytes: number,
): { content: string; records: number; truncated: boolean } {
  const selected = [...records];
  let content = canonicalize({ [key]: selected });
  while (selected.length > 0 && Buffer.byteLength(content) > maxBytes) {
    selected.pop();
    content = canonicalize({ [key]: selected });
  }
  if (Buffer.byteLength(content) > maxBytes) {
    throw new OperateError(
      'E_OPERATE_EVIDENCE_REJECTED',
      `${key} evidence cannot fit inside the configured item limit.`,
    );
  }
  return {
    content,
    records: selected.length,
    truncated: selected.length < records.length,
  };
}

function githubIdentity(canonicalRemote: string): { owner: string; repository: string } | null {
  let url: URL;
  try {
    url = new URL(canonicalRemote.includes('://') ? canonicalRemote : `https://${canonicalRemote}`);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'github.com' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    return null;
  }
  const segments = url.pathname
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  if (segments.length !== 2 || segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))) {
    return null;
  }
  return { owner: segments[0], repository: segments[1] };
}

interface GitHubPageOptions {
  token: string;
  endpoint: string;
  deadline: number;
  maxRecords: number;
  maxBytes: number;
  fetchImpl?: ReadOnlyFetch;
  select(value: unknown): unknown[];
}

async function githubPages(input: GitHubPageOptions): Promise<unknown[]> {
  const results: unknown[] = [];
  const pageSize = Math.min(100, Math.max(1, input.maxRecords));
  const pageLimit = Math.min(5, Math.ceil(input.maxRecords / pageSize));
  if (input.maxBytes < 1_024 || pageLimit < 1) return results;
  const perPageBytes = Math.max(1_024, Math.floor(input.maxBytes / pageLimit));
  for (let page = 1; page <= pageLimit && results.length < input.maxRecords; page += 1) {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) break;
    const endpoint = new URL(input.endpoint);
    endpoint.searchParams.set('per_page', String(pageSize));
    endpoint.searchParams.set('page', String(page));
    const response = await executeRestReadOnlyJson<unknown>(endpoint, {
      method: 'GET',
      allowedHosts: ['api.github.com'],
      timeoutMs: remaining,
      maxBytes: Math.min(perPageBytes, 5 * 1024 * 1024),
      fetchImpl: input.fetchImpl,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${input.token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    const pageRecords = input.select(response);
    const rawPageRecords = Array.isArray(response)
      ? response.length
      : response &&
          typeof response === 'object' &&
          Array.isArray((response as { check_runs?: unknown }).check_runs)
        ? (response as { check_runs: unknown[] }).check_runs.length
        : pageRecords.length;
    results.push(...pageRecords.slice(0, input.maxRecords - results.length));
    if (rawPageRecords < pageSize) break;
  }
  return results;
}

export async function collectGitHubEvidence(input: {
  projectRoot: string;
  workspace: OperatingWorkspaceManifest;
  now: Date;
  deadline: number;
  budgets: EvidenceBudget;
  token?: string;
  fetchImpl?: ReadOnlyFetch;
}): Promise<{ items: CollectedEvidenceItem[]; truncated: boolean }> {
  const token =
    input.token?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    (
      await executeGitHubReadOnly(
        input.projectRoot,
        ['auth', 'token', '--hostname', 'github.com'],
        { allowedHosts: ['github.com'], timeoutMs: input.deadline - Date.now() },
      )
    ).trim();
  if (!token) {
    throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'GitHub credentials are unavailable.');
  }
  const descriptors = [input.workspace.controlRepository, ...input.workspace.components];
  const items: CollectedEvidenceItem[] = [];
  let truncated = false;
  let remainingBytes = input.budgets.maxBytes;
  const maxRecords = Math.min(100, Math.max(1, Math.floor(input.budgets.maxItems / 4)));
  const categoryResponseBytes = Math.max(1_024, Math.floor(input.budgets.maxBytes / 4));
  for (const descriptor of descriptors) {
    const identity = githubIdentity(descriptor.canonicalRemote);
    if (!identity) continue;
    if (Date.now() >= input.deadline || items.length >= input.budgets.maxItems) {
      truncated = true;
      break;
    }
    const base = `https://api.github.com/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repository)}`;
    const categories: Array<{
      id: 'issues' | 'pull-requests' | 'releases' | 'checks';
      endpoint: string;
      claims: string[];
      select(value: unknown): Array<Record<string, unknown>>;
    }> = [
      {
        id: 'issues',
        endpoint: `${base}/issues?state=all`,
        claims: ['customer-signal', 'delivery'],
        select: (value) =>
          (Array.isArray(value) ? value : [])
            .filter(
              (record): record is Record<string, unknown> =>
                Boolean(record) && typeof record === 'object' && !('pull_request' in record),
            )
            .map((record) => ({
              number: record.number ?? null,
              title: record.title ?? null,
              state: record.state ?? null,
              createdAt: record.created_at ?? null,
              updatedAt: record.updated_at ?? null,
              labels: Array.isArray(record.labels)
                ? record.labels
                    .map((label) =>
                      label && typeof label === 'object'
                        ? (label as Record<string, unknown>).name
                        : label,
                    )
                    .filter((label): label is string => typeof label === 'string')
                    .sort()
                : [],
            })),
      },
      {
        id: 'pull-requests',
        endpoint: `${base}/pulls?state=all`,
        claims: ['delivery', 'change-history'],
        select: (value) =>
          (Array.isArray(value) ? value : [])
            .filter(
              (record): record is Record<string, unknown> =>
                Boolean(record) && typeof record === 'object',
            )
            .map((record) => ({
              number: record.number ?? null,
              title: record.title ?? null,
              state: record.state ?? null,
              draft: record.draft ?? null,
              createdAt: record.created_at ?? null,
              updatedAt: record.updated_at ?? null,
              mergedAt: record.merged_at ?? null,
            })),
      },
      {
        id: 'releases',
        endpoint: `${base}/releases`,
        claims: ['delivery', 'change-history'],
        select: (value) =>
          (Array.isArray(value) ? value : [])
            .filter(
              (record): record is Record<string, unknown> =>
                Boolean(record) && typeof record === 'object',
            )
            .map((record) => ({
              id: record.id ?? null,
              tag: record.tag_name ?? null,
              name: record.name ?? null,
              draft: record.draft ?? null,
              prerelease: record.prerelease ?? null,
              createdAt: record.created_at ?? null,
              publishedAt: record.published_at ?? null,
            })),
      },
      {
        id: 'checks',
        endpoint: `${base}/commits/${encodeURIComponent(descriptor.pinnedRevision)}/check-runs`,
        claims: ['delivery', 'reliability'],
        select: (value) => {
          if (!value || typeof value !== 'object') return [];
          const records = (value as { check_runs?: unknown }).check_runs;
          return (Array.isArray(records) ? records : [])
            .filter(
              (record): record is Record<string, unknown> =>
                Boolean(record) && typeof record === 'object',
            )
            .map((record) => ({
              id: record.id ?? null,
              name: record.name ?? null,
              status: record.status ?? null,
              conclusion: record.conclusion ?? null,
              startedAt: record.started_at ?? null,
              completedAt: record.completed_at ?? null,
            }));
        },
      },
    ];
    for (const category of categories) {
      if (
        Date.now() >= input.deadline ||
        items.length >= input.budgets.maxItems ||
        remainingBytes < 1_024
      ) {
        truncated = true;
        break;
      }
      const records = (await githubPages({
        token,
        endpoint: category.endpoint,
        deadline: input.deadline,
        maxRecords,
        maxBytes: Math.min(remainingBytes, categoryResponseBytes),
        fetchImpl: input.fetchImpl,
        select: category.select,
      })) as Array<Record<string, unknown>>;
      const bounded = boundedRecordsContent(
        category.id,
        records,
        Math.min(input.budgets.maxItemBytes, remainingBytes),
      );
      truncated ||= bounded.truncated || records.length >= maxRecords;
      remainingBytes -= Buffer.byteLength(bounded.content);
      if (bounded.records === 0) continue;
      const collectedAt = input.now.toISOString();
      items.push({
        id: evidenceId('github', `${descriptor.componentId}:${category.id}:${bounded.content}`),
        source: 'github',
        location: `${descriptor.componentId}/${category.id}`,
        content: bounded.content,
        collectedAt,
        observedFrom: null,
        observedTo: collectedAt,
        freshness: 'fresh',
        sensitivity: 'confidential',
        claimTypes: category.claims,
        quality: 'observed',
        coverage: bounded.truncated ? 'partial' : 'complete',
      });
    }
  }
  return { items, truncated };
}

interface LinearConnection<T> {
  nodes?: T[];
  pageInfo?: {
    hasNextPage?: boolean;
    endCursor?: string | null;
  };
}

async function linearConnectionPages<T>(input: {
  token: string;
  query: string;
  connection: string;
  variables?: Readonly<Record<string, unknown>>;
  deadline: number;
  maxRecords: number;
  maxBytes: number;
  fetchImpl?: ReadOnlyFetch;
}): Promise<T[]> {
  const records: T[] = [];
  let after: string | null = null;
  const pageSize = Math.min(100, Math.max(1, input.maxRecords));
  const pageLimit = Math.min(5, Math.ceil(input.maxRecords / pageSize));
  const perPageBytes = Math.max(1_024, Math.floor(input.maxBytes / Math.max(1, pageLimit)));
  for (let page = 0; page < pageLimit && records.length < input.maxRecords; page += 1) {
    const remaining = input.deadline - Date.now();
    if (remaining <= 0) break;
    const data: Record<string, LinearConnection<T>> = await executeLinearReadOnlyQuery<
      Record<string, LinearConnection<T>>
    >({
      token: input.token,
      query: input.query,
      variables: {
        ...input.variables,
        first: pageSize,
        after,
      },
      timeoutMs: remaining,
      maxBytes: Math.min(perPageBytes, 5 * 1024 * 1024),
      allowedHosts: ['api.linear.app'],
      fetchImpl: input.fetchImpl,
    });
    const connection: LinearConnection<T> | undefined = data[input.connection];
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
    records.push(...nodes.slice(0, input.maxRecords - records.length));
    if (!connection?.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return records;
}

export async function collectLinearEvidence(input: {
  projectRoot: string;
  now: Date;
  deadline: number;
  budgets: EvidenceBudget;
  token?: string;
  fetchImpl?: ReadOnlyFetch;
  teamIds?: string[];
}): Promise<{ items: CollectedEvidenceItem[]; truncated: boolean }> {
  const token = input.token?.trim() || (await resolveApiKey('linear'))?.trim();
  if (!token) {
    throw new OperateError('E_OPERATE_EVIDENCE_REJECTED', 'Linear credentials are unavailable.');
  }
  const config = input.teamIds ? null : await loadConfig(input.projectRoot).catch(() => null);
  const teamIds = [
    ...new Set(
      (
        input.teamIds ?? [
          config?.linear?.teamId,
          ...(config?.linear?.teams ?? []).map((team) => team.id),
        ]
      ).filter((value): value is string => Boolean(value)),
    ),
  ];
  const maxRecords = Math.min(100, Math.max(1, Math.floor(input.budgets.maxItems / 3)));
  const connectionBudget = Math.max(1_024, Math.floor(input.budgets.maxBytes / 3));
  const teams = await linearConnectionPages<Record<string, unknown>>({
    token,
    query: `query OperatingTeams($first: Int!, $after: String) {
      teams(first: $first, after: $after) {
        nodes { id key name }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    connection: 'teams',
    deadline: input.deadline,
    maxRecords,
    maxBytes: connectionBudget,
    fetchImpl: input.fetchImpl,
  });
  const issues = await linearConnectionPages<{
    id?: string;
    identifier?: string;
    title?: string;
    updatedAt?: string;
    priority?: number;
    team?: { id?: string; key?: string } | null;
    state?: { name?: string } | null;
    labels?: { nodes?: Array<{ name?: string }> } | null;
  }>({
    token,
    query:
      teamIds.length > 0
        ? `query OperatingIssues($first: Int!, $after: String, $teamIds: [ID!]) {
            issues(first: $first, after: $after, filter: { team: { id: { in: $teamIds } } }) {
              nodes {
                id identifier title updatedAt priority
                team { id key }
                state { name }
                labels { nodes { name } }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`
        : `query OperatingIssues($first: Int!, $after: String) {
            issues(first: $first, after: $after) {
              nodes {
                id identifier title updatedAt priority
                team { id key }
                state { name }
                labels { nodes { name } }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
    connection: 'issues',
    variables: teamIds.length > 0 ? { teamIds } : {},
    deadline: input.deadline,
    maxRecords,
    maxBytes: connectionBudget,
    fetchImpl: input.fetchImpl,
  });
  const projects = await linearConnectionPages<{
    id?: string;
    name?: string;
    updatedAt?: string;
    status?: { name?: string } | null;
    teams?: { nodes?: Array<{ id?: string; key?: string; name?: string }> } | null;
  }>({
    token,
    query: `query OperatingProjects($first: Int!, $after: String) {
      projects(first: $first, after: $after) {
        nodes {
          id name updatedAt
          status { name }
          teams { nodes { id key name } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    connection: 'projects',
    deadline: input.deadline,
    maxRecords,
    maxBytes: connectionBudget,
    fetchImpl: input.fetchImpl,
  });
  const selectedProjects =
    teamIds.length === 0
      ? projects
      : projects.filter((project) =>
          (project.teams?.nodes ?? []).some((team) => team.id && teamIds.includes(team.id)),
        );
  const records: Array<{
    id: 'teams' | 'issues' | 'projects';
    values: Array<Record<string, unknown>>;
    claims: string[];
  }> = [
    {
      id: 'teams',
      values: teams.map((team) => ({
        id: team.id ?? null,
        key: team.key ?? null,
        name: team.name ?? null,
      })),
      claims: ['planning', 'operations'],
    },
    {
      id: 'issues',
      values: issues.map((issue) => ({
        id: issue.id ?? null,
        identifier: issue.identifier ?? null,
        title: issue.title ?? null,
        updatedAt: issue.updatedAt ?? null,
        priority: issue.priority ?? null,
        team: issue.team ? { id: issue.team.id ?? null, key: issue.team.key ?? null } : null,
        state: issue.state?.name ?? null,
        labels: (issue.labels?.nodes ?? [])
          .map((label) => label.name)
          .filter((label): label is string => Boolean(label))
          .sort(),
      })),
      claims: ['customer-signal', 'delivery', 'planning'],
    },
    {
      id: 'projects',
      values: selectedProjects.map((project) => ({
        id: project.id ?? null,
        name: project.name ?? null,
        updatedAt: project.updatedAt ?? null,
        status: project.status?.name ?? null,
        teams: (project.teams?.nodes ?? [])
          .map((team) => ({
            id: team.id ?? null,
            key: team.key ?? null,
            name: team.name ?? null,
          }))
          .sort((left, right) => String(left.id).localeCompare(String(right.id))),
      })),
      claims: ['planning', 'operations', 'delivery'],
    },
  ];
  const items: CollectedEvidenceItem[] = [];
  let truncated = false;
  let remainingBytes = input.budgets.maxBytes;
  for (const record of records) {
    if (remainingBytes < 1_024 || items.length >= input.budgets.maxItems) {
      truncated = true;
      break;
    }
    const bounded = boundedRecordsContent(
      record.id,
      record.values,
      Math.min(input.budgets.maxItemBytes, remainingBytes),
    );
    truncated ||= bounded.truncated || record.values.length >= maxRecords;
    remainingBytes -= Buffer.byteLength(bounded.content);
    if (bounded.records === 0) continue;
    const collectedAt = input.now.toISOString();
    items.push({
      id: evidenceId('linear', `${record.id}:${bounded.content}`),
      source: 'linear',
      location: record.id,
      content: bounded.content,
      collectedAt,
      observedFrom: null,
      observedTo: collectedAt,
      freshness: 'fresh',
      sensitivity: 'confidential',
      claimTypes: record.claims,
      quality: 'observed',
      coverage: bounded.truncated ? 'partial' : 'complete',
    });
  }
  return { items, truncated };
}

async function fileImportItems(
  projectRoot: string,
  roots: OperatingWorkspaceRoots,
  budgets: EvidenceBudget,
  now: Date,
  deadline: number,
  localRoot?: string,
): Promise<{ items: CollectedEvidenceItem[]; truncated: boolean }> {
  const preferencesPath = path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
    'preferences.json',
  );
  const preferences = JSON.parse(await readFile(preferencesPath, 'utf8')) as {
    importPaths?: unknown;
  };
  const importPaths = Array.isArray(preferences.importPaths)
    ? preferences.importPaths.filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (importPaths.length === 0) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'The file-import source has no configured evidence paths; rerun `planr operate init --evidence-file <path>`.',
    );
  }
  const allowedRoots = Object.entries(roots.roots).map(([componentId, root]) => ({
    componentId,
    root,
  }));
  const items: CollectedEvidenceItem[] = [];
  let bytes = 0;
  let truncated = false;
  for (const configuredPath of importPaths) {
    if (
      Date.now() >= deadline ||
      items.length >= budgets.maxItems ||
      items.length >= budgets.maxFiles
    ) {
      truncated = true;
      break;
    }
    const remainingBytes = budgets.maxBytes - bytes;
    if (remainingBytes < 1) {
      truncated = true;
      break;
    }
    const imported = await readImportedEvidenceFile({
      projectRoot,
      configuredPath,
      roots: allowedRoots,
      maxBytes: Math.min(budgets.maxItemBytes, remainingBytes),
    });
    const commercialMetric = inferImportedCommercialMetric(imported.content, imported.format);
    bytes += imported.byteCount;
    const collectedAt = now.toISOString();
    items.push({
      id: evidenceId('file-import', `${imported.location}:${canonicalDigest(imported.content)}`),
      source: 'file-import',
      location: imported.location,
      content: imported.content,
      collectedAt,
      observedFrom: null,
      observedTo: collectedAt,
      freshness: 'fresh',
      sensitivity: 'internal',
      claimTypes: [
        'structured-data',
        imported.format,
        ...(commercialMetric.commercial ? ['commercial-metric'] : []),
      ],
      quality: 'self-reported',
      coverage: 'complete',
      ...(commercialMetric.metric ? { metric: commercialMetric.metric } : {}),
    });
  }
  return { items, truncated };
}

interface IncrementalEvidenceRecord {
  implementation: 'openplanr-operate-incremental-evidence';
  key: `sha256:${string}`;
  workspaceDigest?: `sha256:${string}`;
  evidence: OperatingEvidence;
}

const COMMERCIAL_METRIC_TERMS =
  /\b(?:activation|arr|arpu|cac|churn|conversion|customers?|gmv|ltv|margin|mrr|price|pricing|retention|revenue|sales|spend|subscriptions?|users?)\b/i;
const NUMERIC_CLAIM =
  /(?:[$€£]\s*)?\b\d+(?:[.,]\d+)?\s*(?:%|percent|usd|eur|gbp|customers?|users?)?\b/i;

function validIsoWindow(from: unknown, to: unknown): from is string {
  return (
    typeof from === 'string' &&
    typeof to === 'string' &&
    Number.isFinite(Date.parse(from)) &&
    Number.isFinite(Date.parse(to)) &&
    Date.parse(to) >= Date.parse(from)
  );
}

function inferImportedCommercialMetric(
  content: string,
  format: 'json' | 'csv',
): {
  commercial: boolean;
  metric?: NonNullable<CollectedEvidenceItem['metric']>;
} {
  const commercial = COMMERCIAL_METRIC_TERMS.test(content) && NUMERIC_CLAIM.test(content);
  if (!commercial || format !== 'json') return { commercial };
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const candidate =
      parsed.metric && typeof parsed.metric === 'object'
        ? (parsed.metric as Record<string, unknown>)
        : null;
    if (
      !candidate ||
      typeof candidate.identity !== 'string' ||
      !candidate.identity.trim() ||
      typeof candidate.query !== 'string' ||
      !candidate.query.trim() ||
      !validIsoWindow(candidate.observedFrom, candidate.observedTo)
    ) {
      return { commercial };
    }
    return {
      commercial,
      metric: {
        identity: candidate.identity.trim(),
        query: candidate.query.trim(),
        observedFrom: candidate.observedFrom,
        observedTo: candidate.observedTo as string,
      },
    };
  } catch {
    return { commercial };
  }
}

function incrementalEvidencePath(input: EvidenceCollectionInput, key: `sha256:${string}`): string {
  return path.join(
    resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot }).evidence,
    'incremental',
    `${key.slice('sha256:'.length)}.json`,
  );
}

async function readIncrementalEvidence(
  input: EvidenceCollectionInput,
  key: `sha256:${string}`,
): Promise<IncrementalEvidenceRecord | null> {
  if (!input.incremental) return null;
  try {
    const record = JSON.parse(
      await readFile(incrementalEvidencePath(input, key), 'utf8'),
    ) as IncrementalEvidenceRecord;
    if (record.implementation !== 'openplanr-operate-incremental-evidence' || record.key !== key) {
      return null;
    }
    await assertOperatingArtifact('operating-evidence', record.evidence);
    return record;
  } catch {
    return null;
  }
}

async function writeIncrementalEvidence(
  input: EvidenceCollectionInput,
  key: `sha256:${string}`,
  evidence: OperatingEvidence,
): Promise<void> {
  if (
    !input.persistIncremental ||
    input.providers.some((provider) => ['file-import', 'github', 'linear'].includes(provider))
  ) {
    return;
  }
  const target = incrementalEvidencePath(input, key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const record: IncrementalEvidenceRecord = {
    implementation: 'openplanr-operate-incremental-evidence',
    key,
    workspaceDigest: input.workspace.workspaceDigest,
    evidence,
  };
  await writeFile(temporary, `${canonicalize(record)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function evidenceLocationIdentity(item: OperatingEvidenceItem): string {
  return `${item.source}\0${item.location}`;
}

function buildEvidenceDelta(input: {
  incremental: boolean;
  current: OperatingEvidenceItem[];
  baseline: OperatingEvidence | null;
  requiredEvidenceRefs: string[];
}): NonNullable<OperatingEvidence['delta']> {
  const baselineItems = input.baseline?.items ?? [];
  const baselineByLocation = new Map(
    baselineItems.map((item) => [evidenceLocationIdentity(item), item]),
  );
  const currentByLocation = new Map(
    input.current.map((item) => [evidenceLocationIdentity(item), item]),
  );
  const currentById = new Map(input.current.map((item) => [item.id, item]));
  const baselineById = new Map(baselineItems.map((item) => [item.id, item]));
  const changedEvidenceRefs = input.current
    .filter((item) => {
      const prior = baselineByLocation.get(evidenceLocationIdentity(item));
      return (
        !prior ||
        prior.digest !== item.digest ||
        prior.sensitivity !== item.sensitivity ||
        canonicalDigest(prior.metric ?? null) !== canonicalDigest(item.metric ?? null)
      );
    })
    .map((item) => item.id)
    .sort();
  const removedEvidenceRefs = baselineItems
    .filter((item) => !currentByLocation.has(evidenceLocationIdentity(item)))
    .map((item) => item.id)
    .sort();
  const requiredEvidenceRefs = [
    ...new Set(
      input.requiredEvidenceRefs.flatMap((reference) => {
        const current = currentById.get(reference);
        if (current) return [current.id];
        const prior = baselineById.get(reference);
        if (!prior) return [];
        return [currentByLocation.get(evidenceLocationIdentity(prior))?.id ?? prior.id];
      }),
    ),
  ].sort();
  return {
    mode: input.incremental ? (input.baseline ? 'standard' : 'baseline') : 'deep',
    baselineFingerprint: input.baseline?.fingerprint ?? null,
    changedEvidenceRefs,
    requiredEvidenceRefs,
    selectedEvidenceRefs: [...new Set([...changedEvidenceRefs, ...requiredEvidenceRefs])].sort(),
    removedEvidenceRefs,
  };
}

export async function collectOperatingEvidence(
  input: EvidenceCollectionInput,
): Promise<OperatingEvidence> {
  const started = Date.now();
  const now = input.now ?? new Date();
  const deadline = started + input.budgets.maxDurationMs;
  const incrementalKey = canonicalDigest({
    workspaceComponents: [input.workspace.controlRepository, ...input.workspace.components]
      .map((component) => ({
        componentId: component.componentId,
        canonicalRemote: component.canonicalRemote,
        configuredBranch: component.configuredBranch,
      }))
      .sort((left, right) => left.componentId.localeCompare(right.componentId)),
    providers: [...new Set(input.providers)].sort(),
    sensitivityCeiling: input.sensitivityCeiling,
    budgets: input.budgets,
  });
  const baselineRecord = await readIncrementalEvidence(input, incrementalKey);
  const roots = await readRoots(input.projectRoot, input.localRoot);
  const raw: CollectedEvidenceItem[] = [];
  const warnings: string[] = [];
  let truncated = false;
  if (input.providers.includes('repository') || input.providers.includes('planr')) {
    const repository = await repositoryItems(roots, input.workspace, input.budgets, now, {
      includeRepository: input.providers.includes('repository'),
      includePlanr: input.providers.includes('planr'),
      deadline,
    });
    raw.push(...repository.items);
    truncated ||= repository.truncated;
  }
  if (input.providers.includes('git') && Date.now() < deadline) {
    const git = await gitItems(roots, input.workspace, now, deadline);
    raw.push(...git.items);
    truncated ||= git.truncated;
  }
  if (input.providers.includes('github') && Date.now() < deadline) {
    try {
      const github = await collectGitHubEvidence({
        projectRoot: input.projectRoot,
        workspace: input.workspace,
        now,
        deadline,
        budgets: input.budgets,
        token: input.remote?.githubToken,
        fetchImpl: input.remote?.fetchImpl,
      });
      raw.push(...github.items);
      truncated ||= github.truncated;
      if (github.items.length === 0) {
        warnings.push('GitHub evidence found no supported repositories or records.');
      }
    } catch {
      warnings.push('GitHub evidence is unavailable or not authenticated.');
    }
  }
  if (input.providers.includes('linear') && Date.now() < deadline) {
    try {
      const linear = await collectLinearEvidence({
        projectRoot: input.projectRoot,
        now,
        deadline,
        budgets: input.budgets,
        token: input.remote?.linearToken,
        fetchImpl: input.remote?.fetchImpl,
      });
      raw.push(...linear.items);
      truncated ||= linear.truncated;
      if (linear.items.length === 0) {
        warnings.push('Linear evidence returned no configured teams, issues, or projects.');
      }
    } catch {
      warnings.push('Linear evidence is unavailable, not configured, or not authenticated.');
    }
  }
  if (input.providers.includes('file-import') && Date.now() < deadline) {
    const imported = await fileImportItems(
      input.projectRoot,
      roots,
      input.budgets,
      now,
      deadline,
      input.localRoot,
    );
    raw.push(...imported.items);
    truncated ||= imported.truncated;
  }
  const rejected = raw.filter(
    (item) => compareSensitivity(item.sensitivity, input.sensitivityCeiling) > 0,
  );
  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} evidence item(s) exceeded the configured sensitivity ceiling.`,
    );
  }
  const flattened: OperatingEvidenceItem[] = [];
  for (const item of raw
    .filter((candidate) => compareSensitivity(candidate.sensitivity, input.sensitivityCeiling) <= 0)
    .slice(0, input.budgets.maxItems)) {
    try {
      flattened.push(sanitizeEvidenceItem(item));
    } catch (error) {
      if (!(error instanceof OperateError) || error.code !== 'E_OPERATE_SECRET_DETECTED') {
        throw error;
      }
      const details = error.details ?? {};
      const fallback = detectSecretMetadata(item.content)[0];
      const ruleId =
        typeof details.ruleId === 'string' ? details.ruleId : (fallback?.ruleId ?? 'unknown.v1');
      const category =
        typeof details.category === 'string'
          ? (details.category as NonNullable<typeof fallback>['category'])
          : (fallback?.category ?? 'structured-secret');
      const diagnostic = await createEvidenceDiagnostic({
        projectRoot: input.projectRoot,
        item,
        localRoot: input.localRoot,
        detection: {
          ruleId,
          category,
          line:
            typeof details.line === 'number' && Number.isInteger(details.line)
              ? details.line
              : (fallback?.line ?? 1),
          hardBlock:
            typeof details.hardBlock === 'boolean'
              ? details.hardBlock
              : (fallback?.hardBlock ?? false),
        },
      });
      if (diagnostic.classification?.status === 'false-positive') {
        warnings.push(
          `Evidence candidate ${diagnostic.candidateId} was omitted under its exact false-positive classification.`,
        );
        continue;
      }
      // Quarantine the item instead of aborting the entire evidence snapshot.
      // The immutable role-filtered packs never receive its bytes. Readiness
      // evaluation below decides whether enough eligible evidence remains for
      // each lens; an affected lens becomes not_evaluated with a governed gap
      // rather than preventing unrelated lenses from producing useful work.
      warnings.push(
        [
          `Evidence candidate ${diagnostic.candidateId} was quarantined`,
          `(${diagnostic.category}); its value was not persisted or dispatched.`,
          `Inspect with: planr operate evidence diagnose ${diagnostic.candidateId} --json`,
        ].join(' '),
      );
    }
  }
  if (Date.now() >= deadline) {
    truncated = true;
    warnings.push('Evidence collection reached the configured duration budget.');
  }
  const sourceIds = [...new Set(input.providers)].sort();
  const delta = buildEvidenceDelta({
    incremental: Boolean(input.incremental),
    current: flattened,
    baseline: baselineRecord?.evidence ?? null,
    requiredEvidenceRefs: input.requiredEvidenceRefs ?? [],
  });
  const baselineSources = new Map(
    (baselineRecord?.evidence.sources ?? []).map((source) => [source.id, source]),
  );
  const sources = sourceIds.map((id) => {
    const items = flattened.filter((item) => item.source === id);
    const fingerprint = canonicalDigest(evidenceFingerprintItems(items));
    const prior = baselineSources.get(id);
    return {
      id,
      fingerprint,
      status:
        items.length === 0
          ? ('unavailable' as const)
          : delta.mode === 'standard' && prior?.fingerprint === fingerprint
            ? ('unchanged' as const)
            : delta.mode === 'standard'
              ? ('partial' as const)
              : ('collected' as const),
      itemCount: items.length,
      byteCount: items.reduce((sum, item) => sum + Buffer.byteLength(item.summary ?? ''), 0),
    };
  });
  if (delta.mode === 'standard') {
    warnings.push(
      `Standard evidence delta selected ${delta.changedEvidenceRefs.length} changed and ${delta.requiredEvidenceRefs.length} open-item-required evidence item(s).`,
    );
  }
  const evidence: OperatingEvidence = {
    kind: 'operating-evidence',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    cycleId: input.cycleId,
    fingerprint: canonicalDigest({
      workspaceDigest: input.workspace.workspaceDigest,
      items: evidenceFingerprintItems(flattened),
      sources,
      delta,
    }),
    collectedAt: now.toISOString(),
    truncated:
      truncated ||
      flattened.length >= input.budgets.maxItems ||
      sources.reduce((sum, source) => sum + source.byteCount, 0) >= input.budgets.maxBytes,
    items: flattened,
    delta,
    sources,
    warnings,
  };
  const validated = await assertOperatingArtifact('operating-evidence', evidence);
  await writeIncrementalEvidence(input, incrementalKey, validated);
  return validated;
}

/**
 * Convert commercial numbers without reproducible query/window identity into
 * governed gaps before any advisor can turn them into recommendations.
 */
export async function unqualifiedCommercialEvidenceGaps(input: {
  cycleId: string;
  evidence: OperatingEvidence;
  owner: string;
  now: string;
}): Promise<OperatingDataGap[]> {
  const unqualified = input.evidence.items
    .filter(
      (item) =>
        item.claimTypes.includes('commercial-metric') &&
        (!item.metric?.identity.trim() ||
          !item.metric.query.trim() ||
          !validIsoWindow(item.metric.observedFrom, item.metric.observedTo)),
    )
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.location.localeCompare(right.location) ||
        left.id.localeCompare(right.id),
    );
  const gaps = unqualified.map((item, index) => ({
    kind: 'operating-data-gap' as const,
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: `GAP-${String(index + 1).padStart(3, '0')}`,
    cycleId: input.cycleId,
    question: `What reproducible metric query and observation window qualify ${item.location}?`,
    reason:
      'Numeric commercial evidence requires a metric identity, query identity, and bounded observation window before it can support an operating recommendation.',
    unblocks: [],
    affectedRoles: [
      'strategy-finance',
      'product-activation',
      'growth-market',
      'operations-customer',
    ],
    status: 'open' as const,
    owner: input.owner,
    evidenceRefs: [item.id],
    createdAt: input.now,
    updatedAt: input.now,
  }));
  await Promise.all(gaps.map((gap) => assertOperatingArtifact('operating-data-gap', gap)));
  return gaps;
}

export function evidenceProjectionSources(evidence: OperatingEvidence): Array<{
  id: string;
  freshness: OperatingEvidenceItem['freshness'];
  status: string;
  itemCount: number;
}> {
  return evidence.sources.map((source) => ({
    id: source.id,
    freshness: evidence.items.some(
      (item) => item.source === source.id && item.freshness === 'stale',
    )
      ? 'stale'
      : evidence.items.some((item) => item.source === source.id)
        ? 'fresh'
        : 'unknown',
    status: source.status,
    itemCount: source.itemCount,
  }));
}
