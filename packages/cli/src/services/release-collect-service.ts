import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CliBoundaryError } from '../cli/error-boundary.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const RECORD = '\x1e';
const FIELD = '\x1f';
const NO_TAG = /No names found|No tags can describe|cannot describe anything/u;
const CONVENTIONAL = /^([A-Za-z]+)(?:\(([^)]*)\))?(!)?:\s/u;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:\s*(.*)$/u;
const FOOTER_TOKEN = /^(?:BREAKING[ -]CHANGE|[A-Za-z][\w-]*)(?:: | #)/u;
const REVERTED_SHA = /This reverts commit ([0-9a-f]{7,40})/u;
const RECENT_TAGS = 5;
const TOP_AREAS = 20;

export interface ReleaseCollectOptions {
  projectDir: string;
  base?: string;
  head?: string;
  since?: string;
}

export interface ReleaseCommit {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  type: string | null;
  scope: string | null;
  breaking: boolean;
  breakingNotes: string[];
  reverts: string | null;
  files: string[];
}

export interface ReleaseCollection {
  base: { revision: string; sha: string; tag: string | null; date: string } | null;
  since: string | null;
  head: { revision: string; sha: string };
  tags: string[];
  commits: ReleaseCommit[];
  areas: Array<{ area: string; count: number }>;
}

class GitCommandError extends CliBoundaryError {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(
      'E_RELEASE_GIT_FAILED',
      `git ${args.join(' ')} failed: ${stderr.trim() || 'no error output'}`,
      { recovery: 'Check the revisions and that the project directory is a Git repository.' },
    );
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: GIT_MAX_BUFFER });
    return stdout;
  } catch (error) {
    const record = error as { stderr?: unknown; message?: unknown };
    const stderr =
      typeof record.stderr === 'string' && record.stderr.trim() !== ''
        ? record.stderr
        : String(record.message ?? error);
    throw new GitCommandError(args, stderr);
  }
}

async function resolveCommit(cwd: string, revision: string): Promise<string> {
  return (
    await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])
  ).trim();
}

async function revisionBase(
  cwd: string,
  revision: string,
  tag: string | null,
): Promise<NonNullable<ReleaseCollection['base']>> {
  const sha = await resolveCommit(cwd, revision);
  const date = (await git(cwd, ['log', '-1', '--format=%cs', sha])).trim();
  return { revision, sha, tag, date };
}

async function lastTag(cwd: string, headSha: string): Promise<string | null> {
  try {
    return (await git(cwd, ['describe', '--tags', '--abbrev=0', headSha])).trim();
  } catch (error) {
    if (error instanceof GitCommandError && NO_TAG.test(error.stderr)) return null;
    throw error;
  }
}

/** Each `BREAKING CHANGE:` footer value, including continuation lines up to the next footer token. */
function breakingNotes(body: string): string[] {
  const notes: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split('\n')) {
    const start = BREAKING_FOOTER.exec(line);
    if (start) {
      current = [start[1]];
      notes.push('');
    } else if (current && !FOOTER_TOKEN.test(line)) {
      current.push(line);
    } else {
      current = null;
    }
    if (current) notes[notes.length - 1] = current.join('\n').trim();
  }
  return notes.filter((note) => note !== '');
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCommit(record: string): ReleaseCommit {
  const [sha = '', shortSha = '', subject = '', rawBody = '', rawFiles = ''] = record.split(FIELD);
  const body = rawBody.trim();
  const conventional = CONVENTIONAL.exec(subject);
  const notes = breakingNotes(body);
  const isRevert = subject.startsWith('Revert "') || conventional?.[1] === 'revert';
  return {
    sha,
    shortSha,
    subject,
    body,
    type: conventional?.[1] ?? null,
    scope: conventional?.[2] ?? null,
    breaking: conventional?.[3] === '!' || notes.length > 0,
    breakingNotes: notes,
    reverts: isRevert ? (REVERTED_SHA.exec(body)?.[1] ?? null) : null,
    files: rawFiles.split('\n').filter((line) => line.trim() !== ''),
  };
}

/** First two path segments; a top-level file stays as it is. */
function areaOf(file: string): string {
  return file.split('/').slice(0, 2).join('/');
}

function topAreas(commits: ReleaseCommit[]): Array<{ area: string; count: number }> {
  const counts = new Map<string, number>();
  for (const file of commits.flatMap((entry) => entry.files)) {
    counts.set(areaOf(file), (counts.get(areaOf(file)) ?? 0) + 1);
  }
  return [...counts]
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count || a.area.localeCompare(b.area))
    .slice(0, TOP_AREAS);
}

/**
 * Collect the commits between a base and a head revision for release classification.
 * Without a base or `since`, the base is the last tag reachable from head, or all history when there is none.
 * Any Git failure other than "no tag" throws `E_RELEASE_GIT_FAILED`.
 */
export async function collectReleaseChanges(
  options: ReleaseCollectOptions,
): Promise<ReleaseCollection> {
  const cwd = options.projectDir;
  if (options.base !== undefined && options.since !== undefined)
    throw new CliBoundaryError(
      'E_RELEASE_RANGE_CONFLICT',
      'Pass either --base or --since, not both.',
    );
  if (options.since !== undefined && !isCalendarDate(options.since))
    throw new CliBoundaryError(
      'E_RELEASE_SINCE_INVALID',
      `--since must be a calendar date in YYYY-MM-DD form; got "${options.since}".`,
    );

  const headRevision = options.head ?? 'HEAD';
  const headSha = await resolveCommit(cwd, headRevision);
  let base: ReleaseCollection['base'] = null;
  if (options.base !== undefined) {
    base = await revisionBase(cwd, options.base, null);
  } else if (options.since === undefined) {
    const tag = await lastTag(cwd, headSha);
    if (tag !== null) base = await revisionBase(cwd, tag, tag);
  }

  const tags = (await git(cwd, ['tag', '--list', '--sort=-creatordate']))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, RECENT_TAGS);

  const range = base === null ? [headSha] : [`${base.sha}..${headSha}`];
  const since = options.since === undefined ? [] : [`--since=${options.since}`];
  const log = await git(cwd, [
    'log',
    '--no-merges',
    `--format=${RECORD}%H${FIELD}%h${FIELD}%s${FIELD}%b${FIELD}`,
    '--name-only',
    ...since,
    ...range,
    '--',
  ]);
  const commits = log
    .split(RECORD)
    .slice(1)
    .map((record) => parseCommit(record));

  return {
    base,
    since: options.since ?? null,
    head: { revision: headRevision, sha: headSha },
    tags,
    commits,
    areas: topAreas(commits),
  };
}
