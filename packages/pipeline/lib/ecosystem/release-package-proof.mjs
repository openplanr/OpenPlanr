import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { sha256Jcs } from '../protocol/jcs.mjs';

export const RELEASE_REPOSITORY_KEYS = Object.freeze([
  'pipeline',
  'web',
  'cli',
  'skills',
  'marketplace',
]);

export const REQUIRED_RELEASE_DOCUMENTS = Object.freeze([
  'README.md',
  'docs/compatibility-matrix.md',
  'docs/doctor.md',
  'docs/ecosystem-guide.md',
  'docs/ownership-map.md',
  'docs/protocol/README.md',
  'docs/release-checklist.md',
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'E_RELEASE_PACKAGE_PROOF';
  throw error;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function portablePath(value, label = 'path') {
  const normalized = String(value).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) {
    fail(`${label} must be package-relative.`);
  }
  const clean = posix.normalize(normalized);
  if (clean === '..' || clean.startsWith('../') || clean.includes('/../')) {
    fail(`${label} escapes the package root.`);
  }
  return clean.replace(/^\.\//u, '');
}

function archivePath(root, path) {
  return join(root, ...portablePath(path).split('/'));
}

function normalizedArchiveMode(stat) {
  return (stat.mode & 0o111) === 0 ? 0o644 : 0o755;
}

function lstatOrMissing(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function gitArchiveModes(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'utf8' });
  if (result.status !== 0) return new Map();
  const modes = new Map();
  for (const record of result.stdout.split('\0').filter(Boolean)) {
    const match = record.match(/^(100644|100755)\s+[a-f0-9]+\s+\d+\t([\s\S]+)$/u);
    if (match) modes.set(portablePath(match[2]), match[1] === '100755' ? 0o755 : 0o644);
  }
  return modes;
}

function walkRegularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll('\\', '/');
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) fail(`Packed payload contains a symlink at ${path}.`);
      if (stat.isDirectory()) {
        visit(absolute);
      } else if (stat.isFile()) {
        files.push(path);
      } else {
        fail(`Packed payload contains an unsupported filesystem entry at ${path}.`);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function collectTargets(value, conditions, results) {
  if (typeof value === 'string') {
    results.push({ conditions, target: value });
    return;
  }
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectTargets(entry, [...conditions, `[${index}]`], results));
    return;
  }
  if (typeof value === 'object') {
    for (const [condition, entry] of Object.entries(value)) {
      collectTargets(entry, [...conditions, condition], results);
    }
    return;
  }
  fail('Package exports may contain only strings, arrays, objects, or null.');
}

export function enumerateExportTargets(exportsField) {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    fail('package.json exports must be an object.');
  }

  const targets = [];
  for (const [subpath, value] of Object.entries(exportsField)) {
    if (!subpath.startsWith('.')) fail(`Package export ${subpath} is not a public subpath.`);
    const collected = [];
    collectTargets(value, [], collected);
    for (const entry of collected) targets.push({ subpath, ...entry });
  }
  return targets.sort((left, right) =>
    `${left.subpath}\0${left.conditions.join('.')}\0${left.target}`
      .localeCompare(`${right.subpath}\0${right.conditions.join('.')}\0${right.target}`));
}

function wildcardMatches(pattern, files) {
  const star = pattern.indexOf('*');
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return [...files].filter((path) => path.startsWith(prefix) && path.endsWith(suffix));
}

export function verifyExportTargets({ exportsField, archiveFiles }) {
  const files = new Set([...archiveFiles].map((path) => portablePath(path, 'archive path')));
  const results = [];

  for (const entry of enumerateExportTargets(exportsField)) {
    if (!entry.target.startsWith('./')) {
      fail(`Package export ${entry.subpath} targets a non-relative path.`);
    }
    const target = portablePath(entry.target, `export ${entry.subpath}`);
    const starCount = [...target].filter((character) => character === '*').length;
    if (starCount > 1) fail(`Package export ${entry.subpath} contains more than one wildcard.`);

    if (starCount === 1) {
      const matches = wildcardMatches(target, files);
      if (matches.length === 0) fail(`Package export ${entry.subpath} has no archived targets.`);
      results.push({ ...entry, target, matches });
    } else {
      if (!files.has(target)) fail(`Package export ${entry.subpath} is missing archived target ${target}.`);
      results.push({ ...entry, target, matches: [target] });
    }
  }

  return results;
}

function wildcardCapture(pattern, value) {
  const star = pattern.indexOf('*');
  if (star === -1) return null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return value.slice(prefix.length, value.length - suffix.length);
}

function publicSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`;
}

function exportProbeKind(entry, target) {
  if (entry.conditions.includes('types') || /\.d\.[cm]?ts$/u.test(target)) return 'type-only';
  if (target.endsWith('.json')) return 'json';
  if (target.endsWith('.css')) return 'css';
  if (entry.conditions.includes('require') || target.endsWith('.cjs')) return 'require';
  if (/\.(?:mjs|js)$/u.test(target)) return 'import';
  fail(`Runtime export ${entry.subpath} has unsupported installed target ${target}.`);
}

/**
 * Expand every literal and wildcard export condition into an installed-package
 * probe. Type declarations remain explicit proof rows, while every runtime row
 * must be loaded by the isolated consumer.
 */
export function createInstalledExportProbePlan({ packageName, exportsField, archiveFiles }) {
  if (typeof packageName !== 'string' || !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/u.test(packageName)) {
    fail('Installed export proof requires a valid package name.');
  }
  const targets = verifyExportTargets({ exportsField, archiveFiles });
  const probes = [];
  for (const entry of targets) {
    for (const match of entry.matches) {
      const capture = entry.target.includes('*') ? wildcardCapture(entry.target, match) : null;
      if (entry.target.includes('*') && capture === null) {
        fail(`Export ${entry.subpath} wildcard does not bind archived target ${match}.`);
      }
      const concreteSubpath = entry.subpath.includes('*')
        ? entry.subpath.replace('*', capture)
        : entry.subpath;
      if (concreteSubpath.includes('*')) fail(`Export ${entry.subpath} has an unresolved public wildcard.`);
      probes.push({
        subpath: concreteSubpath,
        specifier: publicSpecifier(packageName, concreteSubpath),
        conditions: [...entry.conditions],
        target: match,
        kind: exportProbeKind(entry, match),
      });
    }
  }
  return probes.sort((left, right) =>
    `${left.subpath}\0${left.conditions.join('.')}\0${left.target}`
      .localeCompare(`${right.subpath}\0${right.conditions.join('.')}\0${right.target}`));
}

function installedProbeRunnerSource() {
  return String.raw`import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , planPath, reportPath] = process.argv;
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const packageRoot = realpathSync(plan.packageRoot);
const require = createRequire(import.meta.url);
const inside = (candidate) => {
  const child = relative(packageRoot, candidate);
  return child.length > 0 && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
};
const results = [];
const originalArgv = process.argv;
process.argv = [process.execPath, 'installed-export-probe', '--help'];
try {
  for (const probe of plan.probes) {
    const lexicalTarget = join(packageRoot, ...probe.target.split('/'));
    const stat = lstatSync(lexicalTarget);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe export target for ' + probe.specifier);
    const target = realpathSync(lexicalTarget);
    if (!inside(target)) throw new Error('export target escaped installed package for ' + probe.specifier);

    if (probe.kind === 'type-only') {
      if (readFileSync(target).byteLength === 0) throw new Error('empty type export for ' + probe.specifier);
    } else if (probe.kind === 'json') {
      const resolved = realpathSync(require.resolve(probe.specifier));
      if (resolved !== target || !inside(resolved)) throw new Error('JSON export resolved outside installed bytes for ' + probe.specifier);
      JSON.parse(readFileSync(resolved, 'utf8'));
    } else if (probe.kind === 'css') {
      const resolved = realpathSync(require.resolve(probe.specifier));
      if (resolved !== target || !inside(resolved)) throw new Error('CSS export resolved outside installed bytes for ' + probe.specifier);
      if (readFileSync(resolved).byteLength === 0) throw new Error('empty CSS export for ' + probe.specifier);
    } else if (probe.kind === 'require') {
      const resolved = realpathSync(require.resolve(probe.specifier));
      if (resolved !== target || !inside(resolved)) throw new Error('require export resolved outside installed bytes for ' + probe.specifier);
      require(probe.specifier);
    } else {
      await import(pathToFileURL(target).href);
      const selected = realpathSync(fileURLToPath(import.meta.resolve(probe.specifier)));
      if (!inside(selected)) throw new Error('import export resolved outside installed bytes for ' + probe.specifier);
      if (selected === target) await import(probe.specifier);
    }
    results.push({
      subpath: probe.subpath,
      conditions: probe.conditions,
      kind: probe.kind,
      status: probe.kind === 'type-only' ? 'validated' : 'loaded',
    });
  }
} finally {
  process.argv = originalArgv;
}
writeFileSync(reportPath, JSON.stringify(results));
`;
}

/** Execute the complete probe plan from a disposable consumer next to node_modules. */
export function runInstalledExportProbes({
  packageName,
  exportsField,
  archiveFiles,
  installedPackageRoot,
  consumerRoot,
  environment = process.env,
}) {
  const lexicalRoot = resolve(installedPackageRoot);
  const rootStat = lstatSync(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail(`Installed ${packageName} root is not a real directory.`);
  }
  const root = realpathSync(lexicalRoot);
  walkRegularFiles(root);
  const probes = createInstalledExportProbePlan({ packageName, exportsField, archiveFiles });
  if (probes.length === 0) fail(`Installed ${packageName} has no public export probes.`);
  const planPath = join(consumerRoot, `${packageName.replaceAll('/', '-')}-export-plan.json`);
  const reportPath = join(consumerRoot, `${packageName.replaceAll('/', '-')}-export-report.json`);
  const runnerPath = join(consumerRoot, `${packageName.replaceAll('/', '-')}-export-runner.mjs`);
  writeFileSync(planPath, JSON.stringify({ packageRoot: root, probes }));
  writeFileSync(runnerPath, installedProbeRunnerSource());
  const result = spawnSync(process.execPath, [runnerPath, planPath, reportPath], {
    cwd: consumerRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 2 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim().split(/\r?\n/u).at(-1);
    fail(`Installed ${packageName} export probe failed${detail ? `: ${detail}` : ''}.`);
  }
  let results;
  try {
    results = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    fail(`Installed ${packageName} export probe did not produce a valid report.`);
  }
  if (!Array.isArray(results) || results.length !== probes.length
    || results.some((entry) => !['loaded', 'validated'].includes(entry.status))) {
    fail(`Installed ${packageName} export probe report is incomplete.`);
  }
  const counts = {
    runtime: results.filter(({ status }) => status === 'loaded').length,
    typeOnly: results.filter(({ kind }) => kind === 'type-only').length,
    json: results.filter(({ kind }) => kind === 'json').length,
  };
  return { count: results.length, ...counts, digest: sha256Jcs(results), results };
}

function withoutFencedCode(markdown) {
  const lines = String(markdown).split(/\r?\n/u);
  let fence = null;
  return lines.map((line) => {
    const marker = line.match(/^\s*(```+|~~~+)/u)?.[1] ?? null;
    if (marker) {
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return '';
    }
    return fence === null ? line : '';
  }).join('\n');
}

function markdownTargets(markdown) {
  const targets = [];
  const source = withoutFencedCode(markdown);
  const link = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/gu;
  for (const match of source.matchAll(link)) {
    targets.push(match[1].replace(/^<|>$/gu, ''));
  }
  return targets;
}

function resolveDocumentTarget(documentPath, rawTarget) {
  const withoutFragment = rawTarget.split('#', 1)[0].split('?', 1)[0];
  if (!withoutFragment) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    fail(`Packaged document ${documentPath} contains an invalid encoded link.`);
  }
  if (/^https:\/\//iu.test(decoded) || /^mailto:/iu.test(decoded)) return { kind: 'remote', target: decoded };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(decoded) || decoded.startsWith('/')) {
    fail(`Packaged document ${documentPath} contains a non-stable or package-absolute link.`);
  }
  const target = portablePath(posix.join(posix.dirname(documentPath), decoded), `link in ${documentPath}`);
  return { kind: 'local', target };
}

export function verifyPackagedDocumentation({ packageRoot, archiveFiles }) {
  const files = [...archiveFiles].map((path) => portablePath(path, 'archive path')).sort();
  const fileSet = new Set(files);
  for (const required of REQUIRED_RELEASE_DOCUMENTS) {
    if (!fileSet.has(required)) fail(`Release package is missing required document ${required}.`);
  }

  const documents = files.filter((path) => path === 'README.md' || path.startsWith('docs/'))
    .filter((path) => path.endsWith('.md'));
  const results = [];
  for (const documentPath of documents) {
    const markdown = readFileSync(archivePath(packageRoot, documentPath), 'utf8');
    for (const rawTarget of markdownTargets(markdown)) {
      const resolved = resolveDocumentTarget(documentPath, rawTarget);
      if (resolved === null) continue;
      if (resolved.kind === 'local') {
        const directoryPrefix = `${resolved.target.replace(/\/$/u, '')}/`;
        if (!fileSet.has(resolved.target) && !files.some((path) => path.startsWith(directoryPrefix))) {
          fail(`Packaged document ${documentPath} links to missing archive path ${resolved.target}.`);
        }
      }
      results.push({ documentPath, ...resolved });
    }
  }
  return results;
}

export function comparePackedPayloadToSource({
  sourceRoot,
  extractedPackageRoot,
  packFiles,
  forcedExecutablePaths = [],
  forbiddenByteSequences = [],
}) {
  const reported = [...packFiles]
    .map(({ path, size, mode }) => ({
      path: portablePath(path, 'pack report path'),
      size,
      mode,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const reportedPaths = reported.map(({ path }) => path);
  const extractedPaths = walkRegularFiles(extractedPackageRoot);
  if (JSON.stringify(reportedPaths) !== JSON.stringify(extractedPaths)) {
    fail('Extracted archive inventory does not match the npm pack report.');
  }

  const sourceInventory = [];
  const payloadInventory = [];
  const indexedModes = gitArchiveModes(sourceRoot);
  const forcedExecutables = new Set(forcedExecutablePaths.map((path) => portablePath(path)));
  const forbiddenBytes = forbiddenByteSequences
    .filter((value) => typeof value === 'string' && value.length >= 4)
    .map((value) => Buffer.from(value, 'utf8'));
  for (const entry of reported) {
    const source = archivePath(sourceRoot, entry.path);
    const extracted = archivePath(extractedPackageRoot, entry.path);
    const sourceStat = lstatSync(source);
    if (sourceStat.isSymbolicLink()) fail(`Source package entry ${entry.path} is a symlink.`);
    if (!sourceStat.isFile()) fail(`Source package entry ${entry.path} is not a regular file.`);
    const sourceBytes = readFileSync(source);
    const payloadBytes = readFileSync(extracted);
    if (!sourceBytes.equals(payloadBytes)) fail(`Archive bytes differ from source at ${entry.path}.`);
    if (entry.size !== payloadBytes.byteLength) fail(`Archive size differs from npm pack report at ${entry.path}.`);
    if (forbiddenBytes.some((sequence) => payloadBytes.includes(sequence))) {
      fail(`Archive entry ${entry.path} contains a private source-machine path.`);
    }
    const sourceMode = forcedExecutables.has(entry.path)
      || indexedModes.get(entry.path) === 0o755
      || normalizedArchiveMode(sourceStat) === 0o755
      ? 0o755
      : 0o644;
    if (entry.mode !== sourceMode) fail(`Archive mode differs from source intent at ${entry.path}.`);

    sourceInventory.push({
      path: entry.path,
      mode: sourceMode,
      size: sourceBytes.byteLength,
      contentDigest: sha256Bytes(sourceBytes),
    });
    payloadInventory.push({
      path: entry.path,
      mode: entry.mode,
      size: payloadBytes.byteLength,
      contentDigest: sha256Bytes(payloadBytes),
    });
  }

  const sourceDigest = sha256Jcs(sourceInventory);
  const payloadDigest = sha256Jcs(payloadInventory);
  if (sourceDigest !== payloadDigest) fail('Archive payload digest does not match its source inventory digest.');
  return { sourceInventory, payloadInventory, sourceDigest, payloadDigest };
}

function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (result.status !== 0) fail('A coordinated repository is not readable as a Git checkout.');
  return result.stdout;
}

function parseGitTreeRecords(raw, label) {
  return raw.split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^(\d{6})\s+(\w+)\s+([a-f0-9]+)\t([\s\S]+)$/u);
    if (!match) fail(`Repository ${label} returned an invalid baseline tree record.`);
    return {
      path: portablePath(match[4], `repository ${label} baseline path`),
      mode: match[1],
      type: match[2],
      objectId: match[3],
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function parseGitIndexRecords(raw, label) {
  return raw.split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^(\d{6})\s+([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/u);
    if (!match) fail(`Repository ${label} returned an invalid index record.`);
    const stage = Number.parseInt(match[3], 10);
    if (stage !== 0) fail(`Repository ${label} has an unresolved index conflict.`);
    return {
      path: portablePath(match[4], `repository ${label} index path`),
      mode: match[1],
      objectId: match[2],
      stage,
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function captureRepositoryGeneration(root, label) {
  const baseline = runGit(root, ['rev-parse', 'HEAD']).trim();
  const baselineTree = parseGitTreeRecords(
    runGit(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']),
    label,
  );
  const index = parseGitIndexRecords(runGit(root, ['ls-files', '-s', '-z']), label);
  const untrackedPaths = runGit(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .map((path) => portablePath(path, `repository ${label} untracked path`))
    .sort((left, right) => left.localeCompare(right));
  const statusRecords = runGit(root, [
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]).split('\0').filter(Boolean);
  const generation = { baseline, baselineTree, index, untrackedPaths, statusRecords };
  return { ...generation, generationDigest: sha256Jcs(generation) };
}

function workingInventory(root, label, generation) {
  const baselineByPath = new Map(generation.baselineTree.map((entry) => [entry.path, entry]));
  const indexByPath = new Map(generation.index.map((entry) => [entry.path, entry]));
  const paths = [...new Set([
    ...baselineByPath.keys(),
    ...indexByPath.keys(),
    ...generation.untrackedPaths,
  ])].sort((left, right) => left.localeCompare(right));

  return paths.map((path) => {
    const baseline = baselineByPath.get(path) ?? null;
    const index = indexByPath.get(path) ?? null;
    const absolute = archivePath(root, path);
    const stat = lstatOrMissing(absolute);
    if (stat === null) {
      return {
        path,
        kind: 'deletion',
        tracked: baseline !== null || index !== null,
        baselineMode: baseline?.mode ?? null,
        indexMode: index?.mode ?? null,
        mode: null,
        size: null,
        contentDigest: null,
      };
    }

    if (stat.isSymbolicLink()) fail(`Repository ${label} contains a symlink at ${path}.`);
    if (baseline?.mode === '160000' || index?.mode === '160000') {
      fail(`Repository ${label} contains an unsupported submodule at ${path}.`);
    }
    if (!stat.isFile()) fail(`Repository ${label} contains an unsupported entry at ${path}.`);
    let bytes;
    try {
      bytes = readFileSync(absolute);
    } catch {
      fail(`Repository ${label} changed while reading ${path}.`);
    }
    const executable = baseline?.mode === '100755'
      || index?.mode === '100755'
      || normalizedArchiveMode(stat) === 0o755;
    return {
      path,
      kind: index || baseline ? 'tracked-file' : 'untracked-file',
      tracked: index !== null || baseline !== null,
      baselineMode: baseline?.mode ?? null,
      indexMode: index?.mode ?? null,
      mode: executable ? 0o755 : 0o644,
      size: bytes.byteLength,
      contentDigest: sha256Bytes(bytes),
    };
  });
}

export function inventoryGitRepository({ key, label, root, requireClean = false }) {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) fail(`Repository ${label} is reached through a symlink.`);
  const resolvedRoot = realpathSync(resolve(root));
  const before = captureRepositoryGeneration(resolvedRoot, label);
  if (requireClean && before.statusRecords.length > 0) {
    fail(`Repository ${label} is not clean under the requested policy.`);
  }
  const inventory = workingInventory(resolvedRoot, label, before);
  const after = captureRepositoryGeneration(resolvedRoot, label);
  if (before.generationDigest !== after.generationDigest) {
    fail(`Repository ${label} changed while its candidate inventory was being captured.`);
  }
  const identity = {
    key,
    label,
    baseline: before.baseline,
    dirty: before.statusRecords.length > 0,
    generationDigest: before.generationDigest,
    statusRecords: before.statusRecords,
    index: before.index,
    fileCount: inventory.length,
    inventory,
    inventoryDigest: sha256Jcs(inventory),
  };
  return { ...identity, snapshotDigest: sha256Jcs(identity) };
}

export function createEcosystemCandidateProof({
  repositories,
  inventoryRepository = inventoryGitRepository,
  requireClean = false,
}) {
  const missing = RELEASE_REPOSITORY_KEYS.filter((key) => !repositories[key]?.path);
  if (missing.length > 0) fail(`Coordinated candidate is missing repository custody: ${missing.join(', ')}.`);

  const realRoots = new Set();
  const resolvedRepositories = RELEASE_REPOSITORY_KEYS.map((key) => {
    const repository = repositories[key];
    const presentedRoot = resolve(repository.path);
    if (lstatSync(presentedRoot).isSymbolicLink()) {
      fail(`Coordinated repository ${key} is reached through a symlink.`);
    }
    const root = realpathSync(presentedRoot);
    if (realRoots.has(root)) fail(`Coordinated repository ${key} aliases another repository root.`);
    realRoots.add(root);
    return { key, label: repository.label ?? key, root };
  });
  const capturePass = () => resolvedRepositories.map(({ key, label, root }) =>
    inventoryRepository({
      key,
      label,
      root,
      requireClean,
    }));
  const firstPass = capturePass();
  const inventories = capturePass();
  for (let index = 0; index < inventories.length; index += 1) {
    const firstDigest = firstPass[index].snapshotDigest ?? sha256Jcs(firstPass[index]);
    const secondDigest = inventories[index].snapshotDigest ?? sha256Jcs(inventories[index]);
    if (firstDigest !== secondDigest) {
      fail(`Coordinated repository ${RELEASE_REPOSITORY_KEYS[index]} changed between custody passes.`);
    }
  }
  const identity = {
    schemaVersion: '1.0.0',
    repositoryKeys: RELEASE_REPOSITORY_KEYS,
    repositories: inventories,
  };
  return { ...identity, candidateDigest: sha256Jcs(identity) };
}

export function bindPackageProofToEcosystemCandidate({ packageProof, ecosystemProof }) {
  const pipeline = ecosystemProof.repositories?.find(({ key }) => key === 'pipeline');
  if (!pipeline) fail('Coordinated candidate has no pipeline repository inventory.');
  const candidateByPath = new Map(pipeline.inventory.map((entry) => [entry.path, entry]));
  const projection = packageProof.sourceInventory.map((entry) => {
    const candidate = candidateByPath.get(entry.path);
    if (!candidate || candidate.kind === 'deletion') {
      fail(`Package source ${entry.path} is absent from the coordinated pipeline candidate.`);
    }
    return {
      path: candidate.path,
      mode: candidate.mode,
      size: candidate.size,
      contentDigest: candidate.contentDigest,
    };
  });
  const candidateSourceDigest = sha256Jcs(projection);
  if (candidateSourceDigest !== packageProof.sourceDigest) {
    fail('Package source bytes do not match the coordinated pipeline candidate.');
  }
  const identity = {
    repositoryKey: 'pipeline',
    candidateDigest: ecosystemProof.candidateDigest,
    packageSourceDigest: packageProof.sourceDigest,
    entryCount: projection.length,
  };
  return { ...identity, bindingDigest: sha256Jcs(identity) };
}

/**
 * The per-repository inventory, payload, and export-surface digests a release
 * ledger binds, read from proofs that already exist. Nothing is re-hashed over
 * repository or archive bytes here.
 */
export function releaseProofDigests({ ecosystemProof, packageProof = null }) {
  const inventories = Array.isArray(ecosystemProof?.repositories) ? ecosystemProof.repositories : null;
  if (!inventories) fail('Coordinated candidate proof carries no repository inventories.');
  const repositories = RELEASE_REPOSITORY_KEYS.map((key) => {
    const inventory = inventories.find((entry) => entry?.key === key) ?? null;
    return inventory === null ? { key, present: false } : {
      key,
      present: true,
      baseline: inventory.baseline,
      dirty: inventory.dirty,
      fileCount: inventory.fileCount,
      inventoryDigest: inventory.inventoryDigest,
      snapshotDigest: inventory.snapshotDigest,
    };
  });
  const payload = packageProof === null ? null : {
    repositoryKey: 'pipeline',
    packageName: packageProof.package.name,
    declaredVersion: packageProof.package.version,
    sourceDigest: packageProof.sourceDigest,
    payloadDigest: packageProof.archive.digest,
    exportSurfaceDigest: sha256Jcs(packageProof.exports),
  };
  return { candidateDigest: ecosystemProof.candidateDigest ?? null, repositories, payload };
}

export function createPackagePayloadProof({
  packageJson,
  sourceRoot,
  extractedPackageRoot,
  firstPack,
  secondPack,
  firstArchiveBytes,
  secondArchiveBytes,
}) {
  if (firstPack.name !== packageJson.name || firstPack.version !== packageJson.version) {
    fail('npm pack identity does not match package.json.');
  }
  if (packageJson.name === 'planr-pipeline' && packageJson.version === '0.43.0') {
    fail('The cancelled planr-pipeline 0.43.0 identity cannot be reused.');
  }
  if (firstPack.entryCount !== firstPack.files.length
    || secondPack.entryCount !== secondPack.files.length) {
    fail('npm pack entry count does not match its archive inventory.');
  }
  if (firstPack.size !== firstArchiveBytes.byteLength
    || secondPack.size !== secondArchiveBytes.byteLength) {
    fail('npm pack archive size does not match the produced bytes.');
  }
  const firstUnpackedSize = firstPack.files.reduce((total, { size }) => total + size, 0);
  const secondUnpackedSize = secondPack.files.reduce((total, { size }) => total + size, 0);
  if (firstPack.unpackedSize !== firstUnpackedSize
    || secondPack.unpackedSize !== secondUnpackedSize) {
    fail('npm pack unpacked size does not match its file inventory.');
  }
  if (firstPack.shasum !== secondPack.shasum || firstPack.integrity !== secondPack.integrity) {
    fail('Deterministic repack changed npm archive identity.');
  }
  const firstShasum = createHash('sha1').update(firstArchiveBytes).digest('hex');
  const secondShasum = createHash('sha1').update(secondArchiveBytes).digest('hex');
  const firstIntegrity = `sha512-${createHash('sha512').update(firstArchiveBytes).digest('base64')}`;
  const secondIntegrity = `sha512-${createHash('sha512').update(secondArchiveBytes).digest('base64')}`;
  if (firstPack.shasum !== firstShasum || secondPack.shasum !== secondShasum
    || firstPack.integrity !== firstIntegrity || secondPack.integrity !== secondIntegrity) {
    fail('npm pack archive identity does not bind the produced bytes.');
  }
  const firstArchiveDigest = sha256Bytes(firstArchiveBytes);
  const secondArchiveDigest = sha256Bytes(secondArchiveBytes);
  if (firstArchiveDigest !== secondArchiveDigest) fail('Deterministic repack changed archive bytes.');
  if (JSON.stringify(firstPack.files) !== JSON.stringify(secondPack.files)) {
    fail('Deterministic repack changed archive inventory or modes.');
  }

  const archiveFiles = firstPack.files.map(({ path }) => path);
  for (const path of archiveFiles) {
    const normalized = portablePath(path, 'archive path');
    if (['.git', '.planr', 'node_modules', 'tests'].some((prefix) =>
      normalized === prefix || normalized.startsWith(`${prefix}/`))) {
      fail(`Release archive contains forbidden source-only path ${normalized}.`);
    }
  }
  const parity = comparePackedPayloadToSource({
    sourceRoot,
    extractedPackageRoot,
    packFiles: firstPack.files,
    forcedExecutablePaths: Object.values(packageJson.bin ?? {}),
    forbiddenByteSequences: [resolve(sourceRoot), homedir()],
  });
  const exports = verifyExportTargets({ exportsField: packageJson.exports, archiveFiles });
  const documentation = verifyPackagedDocumentation({
    packageRoot: extractedPackageRoot,
    archiveFiles,
  });
  return {
    schemaVersion: '1.0.0',
    package: { name: firstPack.name, version: firstPack.version },
    archive: {
      entryCount: firstPack.entryCount,
      size: firstPack.size,
      unpackedSize: firstPack.unpackedSize,
      shasum: firstPack.shasum,
      integrity: firstPack.integrity,
      digest: firstArchiveDigest,
      deterministicRepack: true,
      symlinkCount: 0,
    },
    exports,
    documentation,
    ...parity,
  };
}
