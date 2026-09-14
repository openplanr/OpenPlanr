#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = { '@openplanr/protocol': 'packages/protocol', 'planr-pipeline': 'packages/pipeline', openplanr: 'packages/cli' };
const name = process.env.RELEASE_PACKAGE;
const version = process.env.RELEASE_VERSION;
if (!Object.hasOwn(targets, name)) throw new Error('Select an explicit public package');
const manifest = JSON.parse(readFileSync(join(root, targets[name], 'package.json'), 'utf8'));
if (manifest.name !== name || manifest.version !== version || manifest.private === true || manifest.license !== 'MIT') throw new Error('Package identity/version/license is not the reviewed release');
const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
if (!/^git\+https:\/\/github\.com\/openplanr\/OpenPlanr(?:\.git)?$/.test(repository ?? '')) throw new Error('Repository metadata must name the public monorepo');
const pending = readdirSync(join(root, '.changeset')).filter((file) => file.endsWith('.md') && file !== 'README.md');
if (pending.length) throw new Error('Consume and review Changesets before publication');
const requestedOutput = resolve(process.argv[2] ?? '');
let existingParent = requestedOutput;
while (!existsSync(existingParent)) existingParent = dirname(existingParent);
const output = join(realpathSync(existingParent), relative(existingParent, requestedOutput));
if (!process.argv[2] || existsSync(output)) throw new Error('Use a fresh archive output directory');
const outputRelative = relative(root, output);
if (!outputRelative || (!outputRelative.startsWith(`..${sep}`) && outputRelative !== '..')) throw new Error('Publication output must be outside the source checkout');
function assertCleanSource() {
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--'], { cwd: root, stdio: 'pipe' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (untracked.length) throw new Error('Commit or remove untracked files before publication');
}
assertCleanSource();
const tracked = new Set(execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'));
// These are rebuilt and verified by the release workflow from tracked inputs.
// All other published bytes must have a reviewed source entry in Git.
const generatedPrefixes = name === 'openplanr' ? ['dist/', 'lib/host-packages/'] : [];
mkdirSync(output, { recursive: true });
const packed = JSON.parse(execFileSync('npm', ['pack', '--workspace', name, '--ignore-scripts', '--json', '--pack-destination', output], { cwd: root, encoding: 'utf8' }));
if (packed.length !== 1 || packed[0].name !== name || packed[0].version !== version) throw new Error('Packed identity mismatch');
const archive = packed[0];
if (!/^[a-zA-Z0-9._-]+\.tgz$/.test(archive.filename) || !Array.isArray(archive.files)) throw new Error('Invalid npm archive report');
for (const entry of archive.files) {
  const file = entry.path;
  if (typeof file !== 'string' || file.startsWith('/') || file.split('/').some((segment) => segment === '..' || segment === '.')) throw new Error('Unsafe packed file path');
  if (!tracked.has(`${targets[name]}/${file}`) && !generatedPrefixes.some((prefix) => file.startsWith(prefix))) {
    throw new Error(`Packed file is not a reviewed source or declared build output: ${file}`);
  }
}
assertCleanSource();
const publicDependencies = {};
for (const [dependency, range] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies })) {
  if (Object.hasOwn(targets, dependency)) {
    const owner = JSON.parse(readFileSync(join(root, targets[dependency], 'package.json'), 'utf8'));
    if (range !== owner.version) throw new Error('Public workspace dependencies must pin the tested version');
    publicDependencies[dependency] = range;
  }
}
const proof = {
  name, version, filename: archive.filename,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sha256: createHash('sha256').update(readFileSync(join(output, archive.filename))).digest('hex'),
  publicDependencies,
};
writeFileSync(join(output, 'publication.json'), `${JSON.stringify(proof, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(proof)}\n`);
