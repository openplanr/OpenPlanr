import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function recurseExportTarget(value, subpath, conditions, targets) {
  if (typeof value === 'string') {
    targets.push({ subpath, condition: conditions.join('.'), conditions, target: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => recurseExportTarget(entry, subpath, [...conditions, `[${index}]`], targets));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    recurseExportTarget(nested, subpath, [...conditions, key], targets);
  }
}

/** Enumerate every literal target under each public package export condition. */
export function enumerateExportTargets(exportsField) {
  const targets = [];
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) return targets;
  for (const [subpath, value] of Object.entries(exportsField)) {
    recurseExportTarget(value, subpath, [], targets);
  }
  return targets.sort((left, right) =>
    `${left.subpath}:${left.condition}:${left.target}`.localeCompare(
      `${right.subpath}:${right.condition}:${right.target}`,
    ),
  );
}

function wildcardPattern(target) {
  const escaped = target.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'u');
}

export function validateExportTargets(exportsField, packedPaths) {
  const paths = new Set(packedPaths);
  const targets = enumerateExportTargets(exportsField);
  const violations = [];
  for (const entry of targets) {
    if (!entry.subpath.startsWith('.') || !entry.target.startsWith('./')) {
      violations.push(`invalid export target: ${entry.subpath} ${entry.condition || 'default'}`);
      continue;
    }
    const target = entry.target.slice(2);
    const matches = target.includes('*')
      ? [...paths].filter((candidate) => wildcardPattern(target).test(candidate)).sort()
      : paths.has(target) ? [target] : [];
    if (matches.length === 0) violations.push(`missing export target: ${entry.subpath} ${entry.condition || 'default'}`);
    entry.matches = matches;
  }
  return { targets, violations };
}

function wildcardCapture(pattern, value) {
  const star = pattern.indexOf('*');
  if (star === -1) return null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return value.slice(prefix.length, value.length - suffix.length);
}

function probeKind(entry, target) {
  if (entry.conditions.includes('types') || /\.d\.[cm]?ts$/u.test(target)) return 'type-only';
  if (target.endsWith('.css')) return 'asset';
  if (target.endsWith('.json')) return 'json';
  if (entry.conditions.includes('require') || target.endsWith('.cjs')) return 'require';
  if (/\.(?:mjs|js)$/u.test(target)) return 'import';
  throw new Error(`unsupported runtime export target: ${entry.subpath} ${target}`);
}

export function createInstalledExportProbePlan(packageName, exportsField, packedPaths) {
  if (typeof packageName !== 'string' || !/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/u.test(packageName)) {
    throw new Error('installed export proof requires a valid package name');
  }
  const report = validateExportTargets(exportsField, packedPaths);
  if (report.violations.length > 0) throw new Error(report.violations.join('; '));
  return report.targets.flatMap((entry) => entry.matches.map((target) => {
    const capture = entry.target.includes('*') ? wildcardCapture(entry.target.slice(2), target) : null;
    if (entry.target.includes('*') && capture === null) {
      throw new Error(`wildcard export did not bind archived target: ${entry.subpath}`);
    }
    const subpath = entry.subpath.includes('*') ? entry.subpath.replace('*', capture) : entry.subpath;
    if (subpath.includes('*')) throw new Error(`unresolved public export wildcard: ${entry.subpath}`);
    return {
      subpath,
      specifier: subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`,
      conditions: [...entry.conditions],
      target,
      kind: probeKind(entry, target),
    };
  })).sort((left, right) =>
    `${left.subpath}:${left.conditions.join('.')}:${left.target}`.localeCompare(
      `${right.subpath}:${right.conditions.join('.')}:${right.target}`,
    ));
}

function exportProbeRunnerSource() {
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
    } else if (probe.kind === 'asset') {
      const selected = realpathSync(fileURLToPath(import.meta.resolve(probe.specifier)));
      if (selected !== target || !inside(selected) || readFileSync(selected).byteLength === 0) throw new Error('invalid asset export for ' + probe.specifier);
    } else if (probe.kind === 'json') {
      const resolved = realpathSync(require.resolve(probe.specifier));
      if (resolved !== target || !inside(resolved)) throw new Error('JSON export resolved outside installed bytes for ' + probe.specifier);
      JSON.parse(readFileSync(resolved, 'utf8'));
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
      status: probe.kind === 'type-only' || probe.kind === 'asset' ? 'validated' : 'loaded',
    });
  }
} finally {
  process.argv = originalArgv;
}
writeFileSync(reportPath, JSON.stringify(results));
`;
}

export function runInstalledExportProbes({
  packageName,
  exportsField,
  packedPaths,
  installedPackageRoot,
  consumerRoot,
  environment,
}) {
  const lexicalRoot = resolve(installedPackageRoot);
  const stat = lstatSync(lexicalRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`installed ${packageName} root is not a real directory`);
  }
  const root = realpathSync(lexicalRoot);
  inventoryTree(root);
  const probes = createInstalledExportProbePlan(packageName, exportsField, packedPaths);
  if (probes.length === 0) throw new Error(`installed ${packageName} has no public export probes`);
  const stem = packageName.replaceAll('/', '-');
  const planPath = join(consumerRoot, `${stem}-export-plan.json`);
  const reportPath = join(consumerRoot, `${stem}-export-report.json`);
  const runnerPath = join(consumerRoot, `${stem}-export-runner.mjs`);
  writeFileSync(planPath, JSON.stringify({ packageRoot: root, probes }));
  writeFileSync(runnerPath, exportProbeRunnerSource());
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
    throw new Error(`installed ${packageName} export probe failed${detail ? `: ${detail}` : ''}`);
  }
  const results = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(results) || results.length !== probes.length
    || results.some((entry) => !['loaded', 'validated'].includes(entry.status))) {
    throw new Error(`installed ${packageName} export probe report is incomplete`);
  }
  return {
    count: results.length,
    runtime: results.filter(({ status }) => status === 'loaded').length,
    typeOnly: results.filter(({ kind }) => kind === 'type-only').length,
    json: results.filter(({ kind }) => kind === 'json').length,
    digest: payloadDigest(results),
    results,
  };
}

function assertRealSourcePath(sourceRoot, path) {
  let current = sourceRoot;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`package source contains a symbolic link: ${path}`);
  }
  const target = realpathSync(current);
  const child = relative(realpathSync(sourceRoot), target);
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`package source target escapes candidate root: ${path}`);
  }
  return target;
}

export function verifyPackedSourceParity(sourceRoot, packageRoot, packedPaths) {
  const source = realpathSync(sourceRoot);
  const payload = realpathSync(packageRoot);
  const entries = [...packedPaths].sort().map((path) => {
    const sourceTarget = assertRealSourcePath(source, path);
    const payloadTarget = assertRealSourcePath(payload, path);
    const sourceBytes = readFileSync(sourceTarget);
    const payloadBytes = readFileSync(payloadTarget);
    if (!sourceBytes.equals(payloadBytes)) throw new Error(`packed bytes differ from source candidate: ${path}`);
    return { path, bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) };
  });
  return { count: entries.length, digest: payloadDigest(entries), entries };
}

function markdownBodyWithoutCode(text) {
  return text
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/~~~[\s\S]*?~~~/gu, '')
    .replace(/`[^`\n]*`/gu, '');
}

export function validatePackagedMarkdownLinks(packageRoot, packedPaths) {
  const paths = new Set(packedPaths);
  const documents = [...paths]
    .filter((path) => path === 'README.md' || path === 'CONTRIBUTING.md' || path.startsWith('docs/'))
    .filter((path) => path.endsWith('.md'))
    .sort();
  const violations = [];
  for (const document of documents) {
    const text = markdownBodyWithoutCode(readFileSync(join(packageRoot, document), 'utf8'));
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      let target = match[1].trim().replace(/^<|>$/gu, '').split(/\s+["']/u, 1)[0];
      if (!target || /^(?:https?:|mailto:|#)/u.test(target)) continue;
      target = target.split('#', 1)[0].split('?', 1)[0];
      const resolved = posix.normalize(posix.join(posix.dirname(document), target));
      const exists = paths.has(resolved) || [...paths].some((path) => path.startsWith(`${resolved}/`));
      if (resolved.startsWith('../') || !exists) violations.push(`${document}: unresolved local link ${target}`);
    }
  }
  return { documents, violations };
}

export function inventoryTree(root) {
  const inventory = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      const stat = lstatSync(absolute);
      const path = relative(root, absolute).split(sep).join('/');
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        throw new Error(`package payload contains a symbolic link: ${path}`);
      }
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        inventory.push({ path, mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  };
  walk(root);
  return inventory;
}

export function payloadDigest(inventory) {
  return sha256(Buffer.from(JSON.stringify(inventory), 'utf8'));
}

export function payloadBytesEqual(left, right) {
  return JSON.stringify(left.map(({ mode: _mode, ...entry }) => entry))
    === JSON.stringify(right.map(({ mode: _mode, ...entry }) => entry));
}
