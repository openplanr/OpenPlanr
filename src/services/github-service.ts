/**
 * GitHub integration service.
 *
 * Wraps the `gh` CLI to create/update issues, labels, and milestones.
 * All operations use `gh` so authentication is handled by the user's
 * existing GitHub CLI session — no extra API tokens needed.
 */

import { execFile } from 'node:child_process';
import { writeFile as fsWriteFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { which } from '../agents/utils.js';
import type { ArtifactFrontmatter, ArtifactType } from '../models/types.js';
import { logger } from '../utils/logger.js';
import { parseMarkdown } from '../utils/markdown.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  labels: Array<{ name: string }>;
}

// ---------------------------------------------------------------------------
// Label & type mapping
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  epic: 'planr:epic',
  feature: 'planr:feature',
  story: 'planr:story',
  task: 'planr:task',
  quick: 'planr:quick',
};

const LABEL_COLORS: Record<string, string> = {
  'planr:epic': '7B68EE',
  'planr:feature': '4169E1',
  'planr:story': '2E8B57',
  'planr:task': 'DAA520',
  'planr:quick': 'DA70D6',
};

/**
 * Maps artifact types to GitHub issue type names.
 * Only types with a matching GitHub issue type are included.
 */
const ARTIFACT_TO_ISSUE_TYPE: Record<string, string> = {
  task: 'Task',
  quick: 'Task',
  feature: 'Feature',
};

const ISSUE_STATE_TO_STATUS: Record<string, string> = {
  open: 'pending',
  closed: 'done',
};

const STATUS_TO_ISSUE_STATE: Record<string, string> = {
  pending: 'open',
  'in-progress': 'open',
  done: 'closed',
};

// ---------------------------------------------------------------------------
// Error message constants
// ---------------------------------------------------------------------------

const GH_CLI_INSTALL_URL = 'https://cli.github.com/';
const GH_REMOTE_EXAMPLE = 'https://github.com/<owner>/<repo>.git';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureGhCli(): Promise<string> {
  const ghPath = await which('gh');
  if (!ghPath) {
    throw new Error(
      'GitHub CLI (gh) is not installed.\n\n' +
        `  1. Install it from ${GH_CLI_INSTALL_URL}\n` +
        '  2. Run `gh auth login` to authenticate\n' +
        '  3. Re-run your planr github command',
    );
  }
  return ghPath;
}

async function ensureGhAuth(ghPath: string): Promise<void> {
  try {
    await execFileAsync(ghPath, ['auth', 'status'], { maxBuffer: 1024 * 1024 });
  } catch (err) {
    logger.debug('GitHub CLI auth check failed', err);
    throw new Error(
      'GitHub CLI is not authenticated.\n\n' +
        '  Run `gh auth login` to sign in, then re-run your planr github command.',
    );
  }
}

async function gh(args: string[]): Promise<string> {
  const ghPath = await ensureGhCli();
  try {
    const { stdout } = await execFileAsync(ghPath, args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const errObj = err as Error & { stderr?: string };
    const stderr = (errObj.stderr || '').toLowerCase();

    if (stderr.includes('auth login') || stderr.includes('not logged')) {
      throw new Error(
        'GitHub CLI is not authenticated.\n\n' +
          '  Run `gh auth login` to sign in, then re-run your planr github command.',
      );
    }
    if (stderr.includes('not a git repository')) {
      throw new Error(
        'This directory is not a git repository.\n\n' +
          '  Run `git init` and add a GitHub remote, or cd into a GitHub-hosted repo.',
      );
    }
    if (stderr.includes('no git remotes') || stderr.includes('no github remotes')) {
      throw new Error(
        'No GitHub remote found in this repository.\n\n' +
          `  Add one with: git remote add origin ${GH_REMOTE_EXAMPLE}`,
      );
    }
    throw err;
  }
}

async function ghJSON<T>(args: string[]): Promise<T> {
  const output = await gh(args);
  return JSON.parse(output) as T;
}

/** Write content to a temp file, run a callback, then clean up. */
async function withTempFile<T>(content: string, fn: (filePath: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'planr-'));
  const filePath = path.join(dir, 'body.md');
  await fsWriteFile(filePath, content, 'utf-8');
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify that the current directory is a GitHub repo with `gh` authenticated.
 */
export async function verifyGitHubRepo(): Promise<{ owner: string; repo: string }> {
  const ghPath = await ensureGhCli();
  await ensureGhAuth(ghPath);
  const repoInfo = await ghJSON<{ nameWithOwner: string }>([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
  ]);
  const [owner, repo] = repoInfo.nameWithOwner.split('/');
  return { owner, repo };
}

/**
 * Ensure a planr label exists, creating it if missing.
 */
export async function ensureLabel(label: string): Promise<void> {
  const color = LABEL_COLORS[label] || 'CCCCCC';
  try {
    await gh([
      'label',
      'create',
      label,
      '--color',
      color,
      '--description',
      `OpenPlanr ${label}`,
      '--force',
    ]);
  } catch (err) {
    logger.debug('Failed to ensure GitHub label', err);
    // Label already exists or permissions issue — safe to continue
  }
}

/**
 * Get the label name for an artifact type.
 */
export function getLabelForType(type: ArtifactType): string | null {
  return TYPE_LABELS[type] || null;
}

// ---------------------------------------------------------------------------
// Issue body formatting helpers
// ---------------------------------------------------------------------------

/** Remove the first H1 heading line (duplicates issue title). */
function removeH1(content: string): string {
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => /^# /.test(l));
  if (idx !== -1) lines.splice(idx, 1);
  return lines.join('\n');
}

/** Convert relative markdown links to plain text (broken on GitHub). */
function stripRelativeLinks(content: string): string {
  return content.replace(/\[([^\]]+)\]\(\.\.[^)]+\)/g, '$1');
}

/**
 * Extract a `## Heading` section (heading + all content until next `##` or EOF).
 * Returns `[sectionContent, contentWithoutSection]`.
 */
function extractSection(content: string, heading: string): [string | null, string] {
  const lines = content.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return [null, content];

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }

  const section = lines.slice(start, end).join('\n');
  const remaining = [...lines.slice(0, start), ...lines.slice(end)].join('\n');
  return [section, remaining];
}

/** Remove a `## Heading` section entirely. */
function removeSection(content: string, heading: string): string {
  const [, remaining] = extractSection(content, heading);
  return remaining;
}

/** Generate a GitHub markdown metadata table. Skips rows with falsy values. */
function buildMetadataTable(rows: Array<[string, string | undefined]>): string {
  const valid = rows.filter(([, v]) => v);
  if (valid.length === 0) return '';
  const header = '| Field | Value |\n|-------|-------|\n';
  const body = valid.map(([label, value]) => `| **${label}** | ${value} |`).join('\n');
  return `${header}${body}\n`;
}

/** Build the standard OpenPlanr footer (sync depends on this exact format). */
function buildFooter(artifactId: string, artifactType: string): string {
  return [
    '',
    '---',
    `> **OpenPlanr** | \`${artifactId}\` (${artifactType}) | Synced by \`planr github\``,
  ].join('\n');
}

/**
 * Clean the issue title — strip redundant prefixes like "Tasks for FEAT-001: ".
 */
export function cleanTitle(artifactId: string, rawTitle: string): string {
  const cleaned = rawTitle.replace(/^Tasks for \w+-\d+:\s*/i, '');
  return `${artifactId}: ${cleaned}`;
}

// ---------------------------------------------------------------------------
// Type-specific body builders
// ---------------------------------------------------------------------------

function buildTaskBody(content: string, frontmatter: ArtifactFrontmatter): string {
  const meta = buildMetadataTable([
    ['Status', frontmatter.status as string | undefined],
    ['Story', frontmatter.storyId as string | undefined],
    ['Feature', frontmatter.featureId as string | undefined],
  ]);

  let body = content;

  // Strip standalone parent reference lines (already in metadata table)
  body = body.replace(/^\*\*(User Story|Feature|Story):\*\*.*\n?/gm, '');

  // Remove Notes section (references planr CLI, irrelevant on GitHub)
  body = removeSection(body, 'Notes');

  // Extract sections to reorder: Tasks → AC Mapping → Relevant Files → Artifact Sources
  const [tasksSection, withoutTasks] = extractSection(body, 'Tasks');
  const [acSection, withoutAc] = extractSection(withoutTasks, 'Acceptance Criteria Mapping');
  const [filesSection, withoutFiles] = extractSection(withoutAc, 'Relevant Files');
  const [sourcesSection, remaining] = extractSection(withoutFiles, 'Artifact Sources');

  // Convert AC checkboxes to plain list
  const acCleaned = acSection ? acSection.replace(/^(\s*)- \[[ x]\] /gm, '$1- ') : null;

  // Wrap artifact sources in collapsible details
  let sourcesWrapped: string | null = null;
  if (sourcesSection) {
    const sourcesBody = sourcesSection.replace(/^## [^\n]+\n/, '').trim();
    sourcesWrapped = `<details>\n<summary>📋 Artifact Sources</summary>\n\n${sourcesBody}\n</details>`;
  }

  // Reassemble in desired order
  const parts = [
    meta.trim(),
    tasksSection,
    acCleaned,
    filesSection,
    sourcesWrapped,
    remaining.trim() || null,
  ].filter(Boolean);

  return parts.join('\n\n');
}

function buildEpicBody(content: string, frontmatter: ArtifactFrontmatter): string {
  const meta = buildMetadataTable([
    ['Status', frontmatter.status as string | undefined],
    ['Owner', frontmatter.owner as string | undefined],
  ]);
  return `${meta}\n${content.trim()}`;
}

function buildFeatureBody(content: string, frontmatter: ArtifactFrontmatter): string {
  const meta = buildMetadataTable([
    ['Status', frontmatter.status as string | undefined],
    ['Epic', frontmatter.epicId as string | undefined],
    ['Owner', frontmatter.owner as string | undefined],
  ]);
  return `${meta}\n${content.trim()}`;
}

function buildStoryBody(content: string, frontmatter: ArtifactFrontmatter): string {
  const meta = buildMetadataTable([
    ['Status', frontmatter.status as string | undefined],
    ['Feature', frontmatter.featureId as string | undefined],
  ]);
  return `${meta}\n${content.trim()}`;
}

// ---------------------------------------------------------------------------
// Issue body builder (type-aware)
// ---------------------------------------------------------------------------

/**
 * Build issue body from artifact raw markdown.
 * Type-aware: produces clean, professional formatting for each artifact type.
 */
export function buildIssueBody(
  raw: string,
  artifactId: string,
  artifactType: string,
  frontmatter: ArtifactFrontmatter,
): string {
  const { content } = parseMarkdown(raw);
  let cleaned = removeH1(content);
  cleaned = stripRelativeLinks(cleaned);

  let body: string;
  switch (artifactType) {
    case 'task':
    case 'quick':
      body = buildTaskBody(cleaned, frontmatter);
      break;
    case 'epic':
      body = buildEpicBody(cleaned, frontmatter);
      break;
    case 'feature':
      body = buildFeatureBody(cleaned, frontmatter);
      break;
    case 'story':
      body = buildStoryBody(cleaned, frontmatter);
      break;
    default:
      body = cleaned.trim();
  }

  return `${body}\n${buildFooter(artifactId, artifactType)}`;
}

/**
 * Create a GitHub issue from artifact data.
 */
export async function createIssue(
  title: string,
  body: string,
  labels: string[],
  milestone?: string,
): Promise<{ number: number; url: string }> {
  return withTempFile(body, async (bodyFile) => {
    const args = ['issue', 'create', '--title', title, '--body-file', bodyFile];
    for (const label of labels) {
      args.push('--label', label);
    }
    if (milestone) {
      args.push('--milestone', milestone);
    }
    const url = await gh(args);
    const issueNumber = Number.parseInt(url.split('/').pop() || '0', 10);
    return { number: issueNumber, url };
  });
}

/**
 * Update an existing GitHub issue.
 */
export async function updateIssue(
  issueNumber: number,
  opts: { title?: string; body?: string; state?: string },
): Promise<void> {
  if (opts.title || opts.body) {
    const editArgs = ['issue', 'edit', String(issueNumber)];
    if (opts.title) editArgs.push('--title', opts.title);

    if (opts.body) {
      await withTempFile(opts.body, async (bodyFile) => {
        editArgs.push('--body-file', bodyFile);
        await gh(editArgs);
      });
    } else {
      await gh(editArgs);
    }
  }

  if (opts.state === 'closed') {
    await gh(['issue', 'close', String(issueNumber)]);
  } else if (opts.state === 'open') {
    await gh(['issue', 'reopen', String(issueNumber)]);
  }
}

/**
 * Get a GitHub issue by number.
 */
export async function getIssue(issueNumber: number): Promise<GitHubIssue> {
  return ghJSON<GitHubIssue>([
    'issue',
    'view',
    String(issueNumber),
    '--json',
    'number,title,state,url,labels',
  ]);
}

/**
 * List all issues with planr labels.
 */
export async function listPlanrIssues(
  state: 'open' | 'closed' | 'all' = 'all',
  limit = 200,
): Promise<GitHubIssue[]> {
  const labels = Object.values(TYPE_LABELS).join(',');
  return ghJSON<GitHubIssue[]>([
    'issue',
    'list',
    '--label',
    labels,
    '--state',
    state,
    '--json',
    'number,title,state,url,labels',
    '--limit',
    String(limit),
  ]);
}

/**
 * Create or get a GitHub milestone (used for epics).
 */
export async function ensureMilestone(title: string): Promise<string> {
  // Check if milestone already exists
  try {
    const milestones = await ghJSON<Array<{ title: string }>>([
      'api',
      'repos/{owner}/{repo}/milestones',
    ]);
    if (Array.isArray(milestones) && milestones.some((m) => m.title === title)) {
      return title;
    }
  } catch (err) {
    logger.debug('Failed to list GitHub milestones', err);
    // Milestone listing failed, try to create
  }

  // Create milestone
  try {
    await gh([
      'api',
      'repos/{owner}/{repo}/milestones',
      '-f',
      `title=${title}`,
      '-f',
      'state=open',
    ]);
  } catch (err) {
    logger.debug('Failed to create GitHub milestone', err);
    // May already exist, that's fine
  }

  return title;
}

/**
 * Map GitHub issue state to artifact status.
 */
export function issueStateToStatus(state: string): string {
  return ISSUE_STATE_TO_STATUS[state] || 'pending';
}

/**
 * Map artifact status to GitHub issue state.
 */
export function statusToIssueState(status: string): string {
  return STATUS_TO_ISSUE_STATE[status] || 'open';
}

/**
 * Extract the planr artifact type from issue labels.
 */
export function getTypeFromLabels(labels: Array<{ name: string }>): ArtifactType | null {
  const reverseMap: Record<string, ArtifactType> = {};
  for (const [type, label] of Object.entries(TYPE_LABELS)) {
    reverseMap[label] = type as ArtifactType;
  }
  for (const label of labels) {
    if (reverseMap[label.name]) return reverseMap[label.name];
  }
  return null;
}

/**
 * Get the GitHub issue type name for an artifact type, if applicable.
 */
export function getIssueTypeForArtifact(type: ArtifactType): string | null {
  return ARTIFACT_TO_ISSUE_TYPE[type] || null;
}

// ---------------------------------------------------------------------------
// GitHub Issue Types (GraphQL)
// ---------------------------------------------------------------------------

/** Cached repo issue types for the current session. */
let issueTypeCache: Record<string, string> | null = null;

/**
 * Fetch available issue types for the current repo and cache them.
 * Returns a map of issue type name → node ID.
 */
export async function fetchIssueTypes(
  owner: string,
  repo: string,
): Promise<Record<string, string>> {
  if (issueTypeCache) return issueTypeCache;

  try {
    const query = `query { repository(owner: "${owner}", name: "${repo}") { issueTypes(first: 20) { nodes { id name } } } }`;
    const result = await gh(['api', 'graphql', '-f', `query=${query}`]);
    const parsed = JSON.parse(result);
    const nodes = parsed?.data?.repository?.issueTypes?.nodes;
    if (Array.isArray(nodes)) {
      issueTypeCache = {};
      for (const node of nodes) {
        issueTypeCache[node.name] = node.id;
      }
      return issueTypeCache;
    }
  } catch (err) {
    logger.debug('Failed to fetch GitHub issue types', err);
  }

  issueTypeCache = {};
  return issueTypeCache;
}

/**
 * Set the issue type on a GitHub issue via GraphQL.
 * Requires the issue's node ID and the issue type's node ID.
 */
export async function setIssueType(
  owner: string,
  repo: string,
  issueNumber: number,
  issueTypeName: string,
): Promise<void> {
  try {
    const issueTypes = await fetchIssueTypes(owner, repo);
    const issueTypeId = issueTypes[issueTypeName];
    if (!issueTypeId) {
      logger.debug(
        `Issue type "${issueTypeName}" not found in repo. Available: ${Object.keys(issueTypes).join(', ')}`,
      );
      return;
    }

    // Get the issue's node ID
    const issueData = await gh(['issue', 'view', String(issueNumber), '--json', 'id']);
    const { id: issueNodeId } = JSON.parse(issueData);

    // Set the issue type
    await gh([
      'api',
      'graphql',
      '-f',
      `query=mutation { updateIssueIssueType(input: { issueId: "${issueNodeId}", issueTypeId: "${issueTypeId}" }) { issue { id } } }`,
    ]);
  } catch (err) {
    logger.debug(`Failed to set issue type "${issueTypeName}" on #${issueNumber}`, err);
    // Non-fatal — issue was created, just type wasn't set
  }
}
