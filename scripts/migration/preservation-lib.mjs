import { createHash } from 'node:crypto';
import { access, lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export const INVENTORY_PATH = 'conformance/migration/preservation-path-inventory.json';
export const SURFACE_PATH = 'conformance/migration/preservation-surface-catalog.json';
export const BASELINE_PATH = 'conformance/migration/preservation-verification-baseline.json';
export const DOCUMENTATION_PATH = '.planr/reports/preservation-catalog.md';

export const EXPECTED_SOURCES = Object.freeze({
  openplanr: {
    sourceId: 'openplanr-cli',
    cutoffCommit: 'a74466666d7550c1d5acc2baf8591da298c57991',
    packageName: 'openplanr',
    packageVersion: '1.25.3',
    cutoffTrackedPaths: 544,
    includedPaths: 618,
  },
  pipeline: {
    sourceId: 'planr-pipeline',
    cutoffCommit: 'fa591a7e7157b47e10d33e4c30997925779c692e',
    packageName: 'planr-pipeline',
    packageVersion: '0.44.0',
    cutoffTrackedPaths: 1391,
    includedPaths: 1391,
  },
  skills: {
    sourceId: 'skills',
    cutoffCommit: 'd052f6e2c78714d2092d78bd7f6dd7730b050938',
    packageName: '@openplanr/skills',
    packageVersion: '1.26.2',
    cutoffTrackedPaths: 39,
    includedPaths: 39,
  },
  marketplace: {
    sourceId: 'marketplace',
    cutoffCommit: 'c7ffa4de90d7bced11ba7bc21a8ce91ab379171e',
    packageName: 'openplanr-marketplace',
    packageVersion: '1.14.0',
    cutoffTrackedPaths: 13,
    includedPaths: 13,
  },
  web: {
    sourceId: 'openplanr-web',
    cutoffCommit: '785fcd9c268c24b495220e2b8deb9d493cc919e0',
    packageName: 'openplanr-web',
    packageVersion: '0.1.0',
    cutoffTrackedPaths: 137,
    includedPaths: 137,
  },
});

export const ALLOWED_DISPOSITIONS = Object.freeze([
  'exact',
  'moved',
  'merged',
  'regenerated',
  'retired',
  'external',
  'excluded',
]);

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function documentDigest(document) {
  const { documentDigest: _discarded, ...payload } = document;
  return `sha256:${sha256(canonicalize(payload))}`;
}

export function sealDocument(document) {
  return { ...document, documentDigest: documentDigest(document) };
}

export function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readJson(relativeOrAbsolutePath) {
  const absolute = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(REPOSITORY_ROOT, relativeOrAbsolutePath);
  return JSON.parse(await readFile(absolute, 'utf8'));
}

export async function pathKind(relativePath) {
  try {
    const value = await stat(path.join(REPOSITORY_ROOT, relativePath));
    if (value.isFile()) return 'file';
    if (value.isDirectory()) return 'directory';
    if (value.isSymbolicLink()) return 'symlink';
    return 'other';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing';
    throw error;
  }
}

export async function fileSha256(relativePath) {
  return sha256(await readFile(path.join(REPOSITORY_ROOT, relativePath)));
}

export async function exists(relativePath) {
  try {
    await access(path.join(REPOSITORY_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

export function normalizeRelativePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`Unsafe repository-relative path: ${value}`);
  }
  return normalized;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export const FEATURES = Object.freeze([
  ['agile-planning-crud', 'openplanr', 'packages/cli/src/cli/commands'],
  ['backlog-and-quick-planning', 'openplanr', 'packages/cli/src/cli/commands/backlog.ts'],
  ['project-configuration', 'openplanr', 'packages/cli/src/cli/commands/config-deterministic.ts'],
  ['project-context-and-search', 'openplanr', 'packages/cli/src/cli/commands/context.ts'],
  ['reporting-and-estimation', 'openplanr', 'packages/cli/src/cli/commands/report.ts'],
  ['github-and-linear-integrations', 'openplanr', 'packages/cli/src/cli/commands/github.ts'],
  ['setup-update-and-upgrade', 'openplanr', 'packages/cli/src/cli/commands/setup.ts'],
  ['exact-cli-binary-aliases', 'openplanr', 'packages/cli/bin/planr.js'],
  ['guided-interaction', 'planr-pipeline', 'packages/pipeline/lib/guided'],
  ['plan-phase', 'planr-pipeline', 'packages/pipeline/lib/pipeline'],
  ['professional-plan-review', 'planr-pipeline', 'packages/pipeline/lib/pipeline'],
  ['design-workflow', '@openplanr/design', 'packages/design/lib/design'],
  ['design-engine', '@openplanr/design', 'packages/design/lib/design-engine'],
  ['ship-execution', 'planr-pipeline', 'packages/pipeline/lib/pipeline'],
  ['native-runtime-dispatch', 'planr-pipeline', 'packages/pipeline/lib/pipeline'],
  ['browser-qa', 'planr-pipeline', 'packages/pipeline/lib/ship'],
  ['investigation', 'planr-pipeline', 'packages/pipeline/lib/investigate'],
  ['landing-and-release', 'planr-pipeline', 'packages/pipeline/lib/release'],
  ['status-sync-and-doctor', 'openplanr', 'packages/cli/src/cli/commands/status.ts'],
  ['local-dashboard', '@openplanr/dashboard', 'apps/dashboard/src'],
  ['pipeline-state-and-provenance', 'planr-pipeline', 'packages/pipeline/lib/pipeline'],
  ['operate-runtime', '@openplanr/operate', 'packages/operate/lib/operate'],
  ['operate-intelligence', '@openplanr/operate', 'packages/operate/lib/operate'],
  ['operate-governed-execution', '@openplanr/operate', 'packages/operate/lib/operate'],
  ['operate-experience', '@openplanr/operate', 'packages/operate/lib/operate'],
  ['artifact-review', '@openplanr/artifact', 'packages/artifact/lib/artifact'],
  ['live-artifact-room', '@openplanr/artifact', 'packages/artifact/lib/artifact'],
  ['diagram-workflow', '@openplanr/artifact', 'packages/artifact/lib/artifact/diagram'],
  ['protocol-contracts', '@openplanr/protocol', 'packages/protocol/schemas'],
  ['role-and-task-routing', '@openplanr/protocol', 'packages/protocol/registries/roles.json'],
  ['canonical-skills', '@openplanr/skill-runtime', 'skills'],
  ['host-adapter-generation', '@openplanr/skill-runtime', 'adapters'],
  ['skill-evaluation', 'planr-pipeline', 'packages/pipeline/evaluation'],
  ['package-compatibility', 'openplanr-workspace', 'conformance'],
  ['migration-custody', 'openplanr-workspace', 'conformance/migration'],
  ['documentation-and-templates', 'openplanr-workspace', 'docs'],
].map(([featureId, owner, destinationPath]) => ({ featureId, owner, destinationPath })));

export function inferFeatureId(surface, argv) {
  const words = argv.filter((word) => word !== 'pipeline');
  const head = words[0] ?? '';
  if (['epic', 'feature', 'story', 'task', 'sprint', 'checklist', 'rules', 'graph', 'revise', 'refine', 'spec', 'plan', 'quick'].includes(head)) return 'agile-planning-crud';
  if (head === 'backlog') return 'backlog-and-quick-planning';
  if (head === 'config') return 'project-configuration';
  if (['context', 'search'].includes(head)) return 'project-context-and-search';
  if (['report', 'report-linter', 'estimate', 'export', 'evidence'].includes(head)) return 'reporting-and-estimation';
  if (['github', 'linear'].includes(head)) return 'github-and-linear-integrations';
  if (['init', 'setup', 'template', 'update', 'upgrade', 'voice', 'runtime'].includes(head)) return 'setup-update-and-upgrade';
  if (head.startsWith('investigate')) return 'investigation';
  if (['design', 'design-loop', 'design-review', 'design-engine'].includes(head)) return 'design-workflow';
  if (['ship', 'ship-context', 'prepare-ship', 'start-ship', 'advance-ship', 'run-ship-gates', 'finalize-ship', 'reopen-ship'].includes(head)) return 'ship-execution';
  if (['prepare-browser-qa', 'record-browser-qa'].includes(head)) return 'browser-qa';
  if (head === 'land') return 'landing-and-release';
  if (['status', 'sync', 'doctor'].includes(head)) return 'status-sync-and-doctor';
  if (head === 'dashboard') return 'local-dashboard';
  if (head === 'operate') return 'operate-runtime';
  if (head === 'diagram') return 'diagram-workflow';
  if (['prepare-plan-review', 'start-plan-review', 'advance-plan-review', 'decide-plan-review'].includes(head)) return 'professional-plan-review';
  if (['prepare-plan', 'complete-plan', 'plan-context'].includes(head)) return 'plan-phase';
  if (head === 'pipeline') return 'pipeline-state-and-provenance';
  if (surface === 'frozen-host-alias') return 'host-adapter-generation';
  return 'agile-planning-crud';
}

/**
 * Reclassify cutoff mappings as `excluded` once their original bytes are held in
 * private custody. Each record names the mapping and where its archive copy lives
 * relative to `custodyRoot`; already-excluded mappings are left as they are.
 */
export async function excludeCustodyRecords(source, records, { reason, flag, custodyRoot, label }) {
  const inventory = structuredClone(source);
  for (const { mappingId, archivePath } of records) {
    const mapping = inventory.pathMappings.find((entry) => entry.mappingId === mappingId);
    assert(mapping, `${label} is missing from source custody: ${mappingId}`);
    if (mapping.disposition === 'excluded' && mapping.reasonCode === reason) {
      assert(
        mapping.destinations.length === 0 && mapping.verification.policy === 'declared-absence',
        `Invalid ${label.toLowerCase()} disposition: ${mappingId}`,
      );
      continue;
    }
    assert(custodyRoot, `Reclassifying ${mappingId} requires ${flag} with the verified archive directory.`);
    const archived = path.resolve(custodyRoot, archivePath);
    const stats = await lstat(archived);
    assert(stats.isFile() && !stats.isSymbolicLink(), `Archived custody must be a regular file: ${mappingId}`);
    const bytes = await readFile(archived);
    assert(sha256(bytes) === mapping.included.sha256, `Archived custody bytes differ for ${mappingId}.`);
    assert(Boolean(stats.mode & 0o111) === (mapping.included.mode === '100755'), `Archived custody mode differs for ${mappingId}.`);
    mapping.disposition = 'excluded';
    mapping.reasonCode = reason;
    mapping.destinations = [];
    mapping.verification = { policy: 'declared-absence' };
  }
  inventory.coverage.dispositionCounts = {};
  for (const mapping of inventory.pathMappings) {
    inventory.coverage.dispositionCounts[mapping.disposition] =
      (inventory.coverage.dispositionCounts[mapping.disposition] ?? 0) + 1;
  }
  delete inventory.documentDigest;
  return sealDocument(inventory);
}
