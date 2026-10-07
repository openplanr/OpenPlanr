import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type PackageFile = { path: string; digest: string };
export type RuntimePackage = Readonly<{
  sourceRoot: string;
  root: string;
  digest: string;
  version: string;
  files: Array<{ relativePath: string; content: Buffer }>;
}>;
export type RuntimePackageDrift = Readonly<{ changed: string[]; unexpected: string[] }>;
export type RuntimeLocator = Readonly<{
  kind: 'openplanr-installed-skill';
  schemaVersion: '1.0.0';
  sourceRoot: string;
  packageDigest: string;
  packageVersion: string;
  entryPath: string;
}>;

const inventoryName = '.openplanr-content.json';
const digest = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function relativeFile(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !path.posix.isAbsolute(value) &&
    !value.split('/').some((part) => !part || part === '.' || part === '..')
  );
}

function regularFiles(root: string): string[] {
  const metadata = lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('Package root must be a regular directory.');
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return regularFiles(target);
    if (entry.isFile()) return [target];
    throw new Error(`Package contains a symbolic link or unsupported entry: ${target}.`);
  });
}

/** Exact native package bytes are the cache unit; frozen and retained packages are never rewritten. */
export function inspectRuntimePackage(
  sourceRoot: string,
  cacheRoot: string,
  host: string,
  version: string,
  inspectInstalled = true,
): RuntimePackage {
  if (!/^[a-z][a-z0-9-]*$/u.test(host) || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/u.test(version))
    throw new Error('Package identity is invalid.');
  const manifestBytes = readFileSync(path.join(sourceRoot, inventoryName));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    kind?: string;
    files?: PackageFile[];
  };
  if (manifest.kind !== 'openplanr-host-package-content' || !Array.isArray(manifest.files))
    throw new Error('Package content inventory is invalid.');
  const listed = new Set<string>();
  for (const file of manifest.files) {
    if (
      !relativeFile(file.path) ||
      listed.has(file.path) ||
      !/^sha256:[a-f0-9]{64}$/u.test(file.digest)
    )
      throw new Error('Package content inventory has an unsafe or duplicate entry.');
    listed.add(file.path);
  }
  const actual = regularFiles(sourceRoot)
    .map((file) => path.relative(sourceRoot, file).split(path.sep).join('/'))
    .filter((file) => file !== inventoryName);
  if (actual.length !== listed.size || actual.some((file) => !listed.has(file)))
    throw new Error('Package files differ from the reviewed content inventory.');
  const files = manifest.files.map((file) => {
    const content = readFileSync(path.join(sourceRoot, file.path));
    if (digest(content) !== file.digest)
      throw new Error(`Package content failed verification: ${file.path}.`);
    return { relativePath: file.path, content };
  });
  files.push({ relativePath: inventoryName, content: manifestBytes });
  const packageDigest = digest(manifestBytes);
  const root = path.join(cacheRoot, host, version, packageDigest.slice('sha256:'.length));
  const runtimePackage = { sourceRoot, root, digest: packageDigest, version, files };
  if (inspectInstalled) {
    const drift = retainedPackageDrift(runtimePackage);
    if (drift.unexpected.length)
      throw new Error(
        `The immutable runtime package contains unexpected files: ${drift.unexpected.join(', ')}.`,
      );
    if (drift.changed.length)
      throw new Error(`The immutable runtime package was changed: ${drift.changed.join(', ')}.`);
  }
  return runtimePackage;
}

/** Files of the retained copy at `root` that differ from the reviewed package bytes. */
export function retainedPackageDrift(runtimePackage: RuntimePackage): RuntimePackageDrift {
  if (!existsSync(runtimePackage.root)) return { changed: [], unexpected: [] };
  const expected = new Map(runtimePackage.files.map((file) => [file.relativePath, file.content]));
  const installed = regularFiles(runtimePackage.root).map((file) =>
    path.relative(runtimePackage.root, file).split(path.sep).join('/'),
  );
  return {
    changed: [...expected]
      .filter(([relativePath, content]) => {
        const target = path.join(runtimePackage.root, relativePath);
        return existsSync(target) && digest(readFileSync(target)) !== digest(content);
      })
      .map(([relativePath]) => relativePath),
    unexpected: installed.filter((file) => !expected.has(file)).sort(),
  };
}

/** The files a retained runtime package changed or gained, for one line of output. */
export function describePackageDrift(drift: RuntimePackageDrift): string {
  return [...drift.changed, ...drift.unexpected.map((file) => `${file} (added)`)].join(', ');
}

/** Bare direct discovery uses the host's short skill invocation while native suites retain their namespace. */
export function thinDiscoveryMetadata(relativePath: string, content: Buffer): Buffer {
  return relativePath === 'agents/openai.yaml'
    ? Buffer.from(content.toString('utf8').replaceAll('$planr:', '$'))
    : content;
}

export function runtimeLocator(runtimePackage: RuntimePackage, entryPath: string): RuntimeLocator {
  if (
    !relativeFile(entryPath) ||
    !runtimePackage.files.some((file) => file.relativePath === entryPath)
  )
    throw new Error('Skill entry is absent from the verified package.');
  return {
    kind: 'openplanr-installed-skill',
    schemaVersion: '1.0.0',
    sourceRoot: runtimePackage.root,
    packageDigest: runtimePackage.digest,
    packageVersion: runtimePackage.version,
    entryPath,
  };
}

/** Only native discovery metadata is local; instructions and resources stay in the pinned package. */
export function thinSkillEntry(source: Buffer, locator: RuntimeLocator): Buffer {
  const text = source.toString('utf8');
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(text)?.[0];
  if (!frontmatter) throw new Error('Native skill entry has no frontmatter.');
  const host = path.basename(path.dirname(path.dirname(locator.sourceRoot)));
  const invocation =
    host === 'openai'
      ? 'This entry uses direct Codex discovery. Invoke skills by short name (`$plan`, `$ship`). Interpret cached `planr-<name>` identifiers and namespaced invocation examples as `$<name>`.'
      : host === 'claude'
        ? 'This entry uses direct Claude Code discovery. Invoke skills by short name (`/plan`, `/ship`). Interpret cached `planr-<name>` identifiers and namespaced invocation examples as `/<name>`.'
        : host === 'cursor'
          ? 'This entry uses Cursor project rules. Resolve skills through the registered `planr-<name>.mdc` rules (`planr-plan.mdc`, `planr-ship.mdc`). Apply this rule mapping to cached invocation examples.'
          : undefined;
  if (!invocation) throw new Error('Thin discovery has no supported host invocation context.');
  return Buffer.from(
    `${frontmatter}\n# OpenPlanr\n\nRead the complete instructions at ${JSON.stringify(path.join(locator.sourceRoot, locator.entryPath))} before performing this skill. Resolve every relative reference, schema and script from that cached source file's directory, not from this discovery entry. This exact package works offline; do not substitute a global CLI, another installed version or a download.\n\n${invocation} This mapping applies only to skill invocation; keep cached resource paths unchanged.\n`,
  );
}

/** Doctor verifies the pinned closure, not just a mutable locator's claims. */
export function inspectRuntimeLocator(
  directory: string,
  verifiedPackages = new Map<string, string>(),
): RuntimeLocator | null {
  const locatorPath = path.join(directory, 'openplanr.install.json');
  if (!existsSync(locatorPath)) return null;
  const locator = JSON.parse(readFileSync(locatorPath, 'utf8')) as RuntimeLocator;
  if (
    Object.keys(locator).sort().join(',') !==
      'entryPath,kind,packageDigest,packageVersion,schemaVersion,sourceRoot' ||
    locator.kind !== 'openplanr-installed-skill' ||
    locator.schemaVersion !== '1.0.0' ||
    !path.isAbsolute(locator.sourceRoot) ||
    !relativeFile(locator.entryPath) ||
    !/^sha256:[a-f0-9]{64}$/u.test(locator.packageDigest) ||
    typeof locator.packageVersion !== 'string'
  )
    throw new Error('Runtime locator is invalid.');
  const manifest = readFileSync(path.join(locator.sourceRoot, inventoryName));
  if (digest(manifest) !== locator.packageDigest)
    throw new Error('Pinned runtime package inventory changed.');
  // The source root itself is verified, including extras, links and every support file.
  if (verifiedPackages.get(locator.sourceRoot) !== locator.packageDigest) {
    const verified = inspectRuntimePackage(
      locator.sourceRoot,
      path.dirname(path.dirname(path.dirname(locator.sourceRoot))),
      path.basename(path.dirname(path.dirname(locator.sourceRoot))),
      locator.packageVersion,
    );
    if (
      verified.root !== locator.sourceRoot ||
      !verified.files.some((file) => file.relativePath === locator.entryPath)
    )
      throw new Error('Runtime locator does not identify this exact package.');
    verifiedPackages.set(locator.sourceRoot, locator.packageDigest);
  }
  const current = readFileSync(path.join(directory, 'SKILL.md'));
  if (
    !current.equals(
      thinSkillEntry(readFileSync(path.join(locator.sourceRoot, locator.entryPath)), locator),
    )
  )
    throw new Error('Thin skill instructions differ from the pinned package entry.');
  const skillRoot = path.dirname(path.join(locator.sourceRoot, locator.entryPath));
  for (const relative of ['openplanr.skill.json', 'agents/openai.yaml']) {
    const expected = path.join(skillRoot, relative);
    if (
      existsSync(expected) &&
      (!existsSync(path.join(directory, relative)) ||
        !readFileSync(path.join(directory, relative)).equals(
          thinDiscoveryMetadata(relative, readFileSync(expected)),
        ))
    )
      throw new Error('Native discovery metadata differs from the pinned package.');
  }
  return locator;
}

/** Cursor keeps one rule entry; its exact source path includes the immutable content identity. */
export function inspectThinRule(
  target: string,
  verifiedPackages = new Map<string, string>(),
): RuntimeLocator | null {
  const bytes = readFileSync(target);
  const match =
    /Read the complete instructions at ("(?:[^"\\]|\\.)*") before performing this skill\./u.exec(
      bytes.toString('utf8'),
    );
  if (!match) return null;
  const entry = JSON.parse(match[1]) as string;
  if (!path.isAbsolute(entry)) throw new Error('Thin rule has no absolute package source.');
  const sourceRoot = path.dirname(path.dirname(entry));
  const packageVersion = path.basename(path.dirname(sourceRoot));
  const packageDigest = `sha256:${path.basename(sourceRoot)}`;
  const locator: RuntimeLocator = {
    kind: 'openplanr-installed-skill',
    schemaVersion: '1.0.0',
    sourceRoot,
    packageVersion,
    packageDigest,
    entryPath: `rules/${path.basename(entry)}`,
  };
  if (verifiedPackages.get(sourceRoot) !== packageDigest) {
    const verified = inspectRuntimePackage(
      sourceRoot,
      path.dirname(path.dirname(path.dirname(sourceRoot))),
      'cursor',
      packageVersion,
    );
    if (verified.root !== sourceRoot || verified.digest !== packageDigest)
      throw new Error('Thin rule does not identify the exact immutable package.');
    verifiedPackages.set(sourceRoot, packageDigest);
  }
  if (!bytes.equals(thinSkillEntry(readFileSync(entry), locator)))
    throw new Error('Thin rule differs from its pinned package entry.');
  return locator;
}
