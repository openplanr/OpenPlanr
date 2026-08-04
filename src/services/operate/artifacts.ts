import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { OPENPLANR_VERSION } from '../../utils/package-version.js';
import { canonicalDigest, sha256Digest } from './canonical.js';
import { applyJournalTransaction, prepareJournalTransaction } from './journal.js';
import { assertOperatingArtifact } from './protocol.js';
import { listGitPlanrTreeAtRevision, readGitPlanrPathAtRevision } from './read-only-providers.js';
import { redactSensitiveText, sanitizeGeneratedPlainText } from './redaction.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingArtifactSession,
  type OperatingEventHead,
  type OperatingSensitivity,
} from './types.js';
import { isPathInside } from './workspace.js';

const EXTENSIONS: Record<OperatingArtifactSession['artifactType'], string> = {
  markdown: '.md',
  html: '.html',
  json: '.json',
  csv: '.csv',
};

export async function createArtifactSession(input: {
  id: string;
  cycleId: string;
  artifactType: OperatingArtifactSession['artifactType'];
  inputDigest: `sha256:${string}`;
  destination: string;
  evidenceRefs: string[];
  runtime: string;
  capability?: 'analysis-standard' | 'analysis-high';
  now?: string;
}): Promise<OperatingArtifactSession> {
  if (
    path.isAbsolute(input.destination) ||
    path.extname(input.destination).toLowerCase() !== EXTENSIONS[input.artifactType]
  ) {
    throw new OperateError(
      'E_OPERATE_ARTIFACT_REJECTED',
      'Artifact destination must be project-relative and match the declared type.',
    );
  }
  const now = input.now ?? new Date().toISOString();
  const session: OperatingArtifactSession = {
    kind: 'operating-artifact-session',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: input.id,
    cycleId: input.cycleId,
    state: 'prepared',
    artifactType: input.artifactType,
    inputDigest: input.inputDigest,
    destination: input.destination,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    producer: {
      product: 'openplanr',
      version: OPENPLANR_VERSION,
      runtime: input.runtime,
      capability: input.capability ?? 'analysis-standard',
    },
    createdAt: now,
    updatedAt: now,
  };
  return assertOperatingArtifact('operating-artifact-session', session);
}

export async function commitGeneratedArtifact(input: {
  projectRoot: string;
  session: OperatingArtifactSession;
  content: string;
  eventHead: OperatingEventHead;
  previewDigest: `sha256:${string}`;
  localRoot?: string;
}): Promise<OperatingArtifactSession> {
  if (input.session.state !== 'prepared' && input.session.state !== 'generating') {
    throw new OperateError(
      'E_OPERATE_ARTIFACT_REJECTED',
      `Artifact session cannot commit from ${input.session.state}.`,
    );
  }
  const sanitized =
    input.session.artifactType === 'json'
      ? `${JSON.stringify(JSON.parse(input.content), null, 2)}\n`
      : sanitizeGeneratedPlainText(input.content);
  const outputDigest = sha256Digest(sanitized);
  const now = new Date().toISOString();
  const committed: OperatingArtifactSession = {
    ...input.session,
    state: 'committed',
    outputDigest,
    updatedAt: now,
  };
  await assertOperatingArtifact('operating-artifact-session', committed);
  const sessionPath = `.planr/operate/artifacts/${input.session.id}.json`;
  const existingSession = await readFile(path.join(input.projectRoot, sessionPath)).catch(
    () => null,
  );
  const writes = [
    {
      relativePath: input.session.destination,
      operation: (await readFile(path.join(input.projectRoot, input.session.destination)).catch(
        () => null,
      ))
        ? ('replace' as const)
        : ('create' as const),
      content: sanitized,
    },
    {
      relativePath: sessionPath,
      operation: existingSession ? ('replace' as const) : ('create' as const),
      content: `${JSON.stringify(committed, null, 2)}\n`,
    },
  ];
  const transaction = await prepareJournalTransaction(input.projectRoot, {
    writes,
    eventHead: input.eventHead,
    previewDigest: input.previewDigest,
    localRoot: input.localRoot,
  });
  await applyJournalTransaction(input.projectRoot, transaction, {
    currentEventHead: input.eventHead,
  });
  return committed;
}

// Planr-artifact citations name a control artifact by its stable ID; the file
// lives in a prefix-derived `.planr/` directory but its slug is unknown, so the
// resolver lists the directory at the pinned revision and matches on the ID.
//
// The keys are the product's REAL artifact-class prefixes: the default
// `.planr/config.json` `idPrefix` values (EPIC/FEAT/US/TASK/QT/BL/SPRINT/SPEC)
// plus the operate register classes (ADR/DEC/FND/GAP/OUT). The bootstrap map
// handed to every advisor points at `.planr/backlog` and `.planr/quick` as
// primary evidence, so `BL-*` (backlog) and `QT-*` (quick-task) citations must
// resolve rather than fail the anchor as an unknown class.
const PLANR_ARTIFACT_DIRECTORIES: Record<string, string[]> = {
  EPIC: ['.planr/epics'],
  FEAT: ['.planr/features'],
  US: ['.planr/stories'],
  SPEC: ['.planr/specs'],
  TASK: ['.planr/tasks'],
  QT: ['.planr/quick'],
  BL: ['.planr/backlog'],
  SPRINT: ['.planr/sprints'],
  ADR: ['.planr/adrs'],
  DEC: ['.planr/decisions', '.planr/operate/decisions'],
  FND: ['.planr/findings', '.planr/operate/findings'],
  GAP: ['.planr/gaps', '.planr/operate/gaps'],
  OUT: ['.planr/outcomes', '.planr/operate/outcomes'],
};

/**
 * The real planr artifact-class prefixes a `planr`-kind citation may name,
 * derived from the directory map so the anchor allowlist and the resolver can
 * never drift. Sorted for a deterministic, byte-stable alternation.
 */
export const PLANR_ARTIFACT_CLASS_PREFIXES: readonly string[] = Object.freeze(
  Object.keys(PLANR_ARTIFACT_DIRECTORIES).sort(),
);

const PLANR_ARTIFACT_ID_PATTERN = new RegExp(
  `^(?:${PLANR_ARTIFACT_CLASS_PREFIXES.join('|')})-[A-Za-z0-9._-]+$`,
);

/** Whether `id` names a known planr artifact class (`EPIC-…`, `BL-…`, `QT-…`, …). */
export function isPlanrArtifactId(id: string): boolean {
  return PLANR_ARTIFACT_ID_PATTERN.test(id);
}

export interface PlanrArtifactCitationResolution {
  /** Engine-computed existence fact the citation resolver consumes fail-closed. */
  artifactExists: boolean;
  /** The `.planr/`-relative path that was snapshotted, or null when nothing resolved. */
  location: string | null;
  /** Redacted artifact content, snapshotted through the same path repository citations use. */
  content: string | null;
  sensitivity: OperatingSensitivity;
  redactions: string[];
}

function planrArtifactPrefix(artifactId: string): string | null {
  const match = artifactId.match(/^([A-Z]+)-/);
  return match ? match[1] : null;
}

/** Whether a listed directory entry names the artifact ID (`ID`, `ID-slug`, or `ID.ext`). */
function entryMatchesArtifact(entry: string, artifactId: string): boolean {
  return (
    entry === artifactId || entry.startsWith(`${artifactId}-`) || entry.startsWith(`${artifactId}.`)
  );
}

const PLANR_WORKING_TREE_MAX_BYTES = 1024 * 1024;

/**
 * Read one working-tree `.planr/` file for the gitignored fallback, bounded and
 * fail-closed. Returns null when the path is absent, is not a plain file, or
 * exceeds the byte bound — a citation into it then fails closed rather than
 * snapshotting a partial or oversized body.
 */
async function readWorkingTreePlanrFile(
  absolutePath: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size > maxBytes) return null;
    return await readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Working-tree fallback for a planr-artifact citation whose ID is absent from the
 * committed tree at the pinned revision — the FR8 gitignored `.planr/` case. The
 * committed revision stays authoritative: this reads from disk ONLY when the pin
 * has no matching artifact, because a gitignored planning directory is never in
 * any commit yet remains a legitimate, citable local planning surface. The scan
 * is bounded to the fixed `.planr/` directory allowlist (never a caller path),
 * stays inside the project root, and passes the same redaction path committed
 * planr artifacts use, so a gitignored artifact resolves with a verified,
 * redacted snapshot rather than being misclassified as unresolvable.
 */
async function resolveWorkingTreePlanrArtifact(input: {
  projectRoot: string;
  directories: readonly string[];
  artifactId: string;
  sensitivity: OperatingSensitivity;
  maxBytes?: number;
}): Promise<PlanrArtifactCitationResolution | null> {
  const maxBytes = Math.max(
    1,
    Math.min(input.maxBytes ?? PLANR_WORKING_TREE_MAX_BYTES, PLANR_WORKING_TREE_MAX_BYTES),
  );
  const root = path.resolve(input.projectRoot);
  const snapshotBody = async (
    absolutePath: string,
    location: string,
  ): Promise<PlanrArtifactCitationResolution> => {
    const body = await readWorkingTreePlanrFile(absolutePath, maxBytes);
    if (body === null) {
      return {
        artifactExists: true,
        location,
        content: null,
        sensitivity: input.sensitivity,
        redactions: [],
      };
    }
    const redacted = redactSensitiveText(body);
    return {
      artifactExists: true,
      location,
      content: redacted.value,
      sensitivity: input.sensitivity,
      redactions: redacted.redactions,
    };
  };

  for (const directory of input.directories) {
    const directoryAbs = path.resolve(root, ...directory.split('/'));
    if (!isPathInside(root, directoryAbs)) continue;
    let entries: string[];
    try {
      entries = await readdir(directoryAbs);
    } catch {
      continue;
    }
    const match = entries.find((entry) => entryMatchesArtifact(entry, input.artifactId));
    if (!match) continue;
    const matchAbs = path.resolve(directoryAbs, match);
    if (!isPathInside(root, matchAbs)) continue;
    const location = `${directory}/${match}`;
    if (path.extname(match)) {
      return snapshotBody(matchAbs, location);
    }
    // Directory-shaped artifact (e.g. a SPEC bundle): look one level in for a
    // same-ID markdown body, mirroring the committed-tree resolution.
    let nested: string[];
    try {
      nested = await readdir(matchAbs);
    } catch {
      return {
        artifactExists: true,
        location,
        content: null,
        sensitivity: input.sensitivity,
        redactions: [],
      };
    }
    const nestedMarkdown =
      nested.find(
        (entry) => entryMatchesArtifact(entry, input.artifactId) && entry.endsWith('.md'),
      ) ?? nested.find((entry) => entry.endsWith('.md'));
    if (nestedMarkdown) {
      const nestedAbs = path.resolve(matchAbs, nestedMarkdown);
      if (isPathInside(root, nestedAbs)) {
        return snapshotBody(nestedAbs, `${location}/${nestedMarkdown}`);
      }
    }
    return {
      artifactExists: true,
      location,
      content: null,
      sensitivity: input.sensitivity,
      redactions: [],
    };
  }
  return null;
}

/**
 * Resolve a planr-artifact citation against `.planr/` at the cycle's pinned
 * revision (FR3/E-003). Computes the `artifactExists` fact the citation resolver
 * consumes and, when the artifact is a readable markdown/text file, snapshots its
 * content through the same redaction path repository citations use.
 *
 * The committed tree at the pinned revision is authoritative: a tracked artifact
 * resolves against its pinned content, and an in-flight EDIT to a tracked
 * artifact still reads the pinned (committed) version, not the working copy. When
 * the ID is absent from the committed tree entirely — the FR8 gitignored `.planr/`
 * case, where the planning directory is never committed — resolution falls back
 * to the working-tree copy so a gitignored planning artifact resolves with a
 * verified, redacted content snapshot instead of failing closed as unresolvable.
 */
export async function resolvePlanrArtifactCitation(input: {
  projectRoot: string;
  pinnedRevision: string;
  artifactId: string;
  sensitivity?: OperatingSensitivity;
  maxBytes?: number;
  timeoutMs?: number;
}): Promise<PlanrArtifactCitationResolution> {
  const sensitivity = input.sensitivity ?? 'internal';
  const empty: PlanrArtifactCitationResolution = {
    artifactExists: false,
    location: null,
    content: null,
    sensitivity,
    redactions: [],
  };
  if (!isPlanrArtifactId(input.artifactId)) return empty;
  const prefix = planrArtifactPrefix(input.artifactId);
  const directories = prefix ? PLANR_ARTIFACT_DIRECTORIES[prefix] : undefined;
  if (!directories) return empty;

  for (const directory of directories) {
    const entries = await listGitPlanrTreeAtRevision(
      input.projectRoot,
      input.pinnedRevision,
      directory,
      {
        timeoutMs: input.timeoutMs,
      },
    );
    const match = entries.find((entry) => entryMatchesArtifact(entry, input.artifactId));
    if (!match) continue;
    // The ID resolves at the pinned revision. Snapshot the artifact body when it
    // is a directly readable file; a directory-shaped artifact (e.g. a SPEC
    // bundle) still resolves, and its primary markdown is snapshotted when present.
    const directFile = `${directory}/${match}`;
    const directBlob = path.extname(match)
      ? await readGitPlanrPathAtRevision(input.projectRoot, input.pinnedRevision, directFile, {
          maxBytes: input.maxBytes,
          timeoutMs: input.timeoutMs,
        })
      : { exists: false, content: null, lineCount: 0 };
    if (directBlob.exists && directBlob.content !== null) {
      const redacted = redactSensitiveText(directBlob.content);
      return {
        artifactExists: true,
        location: directFile,
        content: redacted.value,
        sensitivity,
        redactions: redacted.redactions,
      };
    }
    // Directory-shaped artifact: look one level in for a same-ID markdown file.
    const nested = await listGitPlanrTreeAtRevision(
      input.projectRoot,
      input.pinnedRevision,
      directFile,
      { timeoutMs: input.timeoutMs },
    );
    const nestedMarkdown =
      nested.find(
        (entry) => entryMatchesArtifact(entry, input.artifactId) && entry.endsWith('.md'),
      ) ?? nested.find((entry) => entry.endsWith('.md'));
    if (nestedMarkdown) {
      const nestedBlob = await readGitPlanrPathAtRevision(
        input.projectRoot,
        input.pinnedRevision,
        `${directFile}/${nestedMarkdown}`,
        { maxBytes: input.maxBytes, timeoutMs: input.timeoutMs },
      );
      if (nestedBlob.exists && nestedBlob.content !== null) {
        const redacted = redactSensitiveText(nestedBlob.content);
        return {
          artifactExists: true,
          location: `${directFile}/${nestedMarkdown}`,
          content: redacted.value,
          sensitivity,
          redactions: redacted.redactions,
        };
      }
    }
    // The ID exists as a tree even if no snapshot-able body was found.
    return {
      artifactExists: true,
      location: directFile,
      content: null,
      sensitivity,
      redactions: [],
    };
  }
  // The ID resolves against no committed tree at the pin. Fall back to the
  // working tree for the gitignored `.planr/` case (FR8) before failing closed.
  const workingTree = await resolveWorkingTreePlanrArtifact({
    projectRoot: input.projectRoot,
    directories,
    artifactId: input.artifactId,
    sensitivity,
    maxBytes: input.maxBytes,
  });
  return workingTree ?? empty;
}

export function artifactInputDigest(input: {
  cycleId: string;
  evidenceRefs: string[];
  purpose: string;
}): `sha256:${string}` {
  return canonicalDigest({
    cycleId: input.cycleId,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    purpose: input.purpose,
  });
}
