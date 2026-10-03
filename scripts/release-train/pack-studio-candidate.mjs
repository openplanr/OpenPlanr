#!/usr/bin/env node
// Rebuild exact committed public package inputs for the linked private Studio checks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const destination = process.argv[2];
if (!destination || process.argv.length !== 3)
  throw new TypeError('Supply one empty output directory for the Studio candidate.');
const output = resolve(destination);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length !== 0)
  throw new Error('The candidate output directory must be empty.');
const environment = { ...process.env };
// Candidate custody must stay attached to this checkout and its committed generators.
for (const key of Object.keys(environment)) if (key.startsWith('GIT_')) delete environment[key];
environment.GIT_NO_REPLACE_OBJECTS = '1';
for (const key of [
  'OPENPLANR_ECOSYSTEM_SOURCE',
  'OPENPLANR_ECOSYSTEM_ROOT',
  'OPENPLANR_PIPELINE_ROOT',
  'OPENPLANR_PIPELINE_SOURCE',
  'OPENPLANR_PIPELINE_TARBALL',
  'OPENPLANR_PIPELINE_PACKAGE_ROOT',
  'OPENPLANR_PACKED_PIPELINE_ROOT',
  'OPENPLANR_PACKED_PIPELINE_SOURCE_ROOT',
  'OPENPLANR_VERIFIER_SOURCE_ROOT',
  'OPENPLANR_DASHBOARD_ROOT',
  'PLANR_PIPELINE_ROOT',
  'PLANR_PIPELINE_VERIFIER_SOURCE_ROOT',
  'PLANR_OPENPLANR_ROOT',
])
  delete environment[key];
for (const key of Object.keys(environment))
  if (/^npm_config_(?:workspace|workspaces|include_workspace_root|prefix)$/iu.test(key))
    delete environment[key];
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: environment, encoding: 'utf8' }).trim();
if (git(root, 'status', '--porcelain', '--untracked-files=no'))
  throw new Error('Commit the reviewed public source before packing the CI candidate.');
const commit = git(root, 'rev-parse', 'HEAD');
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit)
  throw new Error('The checkout does not match the requested CI commit.');
const scopes = ['packages/protocol', 'packages/pipeline'];
const temporary = await mkdtemp(join(tmpdir(), 'openplanr-studio-candidate-'));
try {
  const checkout = join(temporary, 'source');
  // A local clone copies committed Git objects, never ambient node_modules or ignored outputs.
  // No worktree is registered in the source repository, and cleanup owns only this temporary tree.
  git(temporary, 'clone', '--quiet', '--no-hardlinks', '--no-checkout', '--', root, checkout);
  git(checkout, 'checkout', '--quiet', '--detach', commit);
  if (git(checkout, 'rev-parse', 'HEAD') !== commit)
    throw new Error('The disposable candidate checkout differs from the reviewed commit.');
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'));
  if (
    !manifest.scripts ||
    ['generate', 'build'].some(
      (command) =>
        typeof manifest.scripts[command] !== 'string' || !manifest.scripts[command].trim(),
    )
  )
    throw new Error(
      'Committed candidate source must declare its generation and build prerequisites.',
    );
  await readFile(join(checkout, 'package-lock.json'));
  const npmExecutable = process.env.npm_execpath ? process.execPath : 'npm';
  const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
  const npm = (args, options = {}) =>
    execFileSync(npmExecutable, [...npmPrefix, ...args], {
      cwd: checkout,
      env: environment,
      ...options,
    });
  // These mandatory root commands are the same prerequisites used by Workspace CI.
  // Fixture repositories declare minimal real scripts; production has no skip switch.
  npm(['ci', '--include=dev', '--include=optional'], { stdio: ['ignore', 2, 2] });
  npm(['run', 'generate'], { stdio: ['ignore', 2, 2] });
  npm(['run', 'build'], { stdio: ['ignore', 2, 2] });
  const assertBuiltSource = () => {
    if (git(checkout, 'status', '--porcelain', '--untracked-files=all'))
      throw new Error(
        'Candidate generation/build changed committed source or left undeclared outputs.',
      );
  };
  assertBuiltSource();
  const packed = JSON.parse(
    npm(
      [
        'pack',
        ...scopes.map((scope) => `./${scope}`),
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        output,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  assertBuiltSource();
  if (!Array.isArray(packed) || packed.length !== scopes.length)
    throw new Error('The candidate must contain exactly the Protocol and pipeline packages.');
  const packages = [];
  for (const [index, scope] of scopes.entries()) {
    const expected = JSON.parse(await readFile(join(checkout, scope, 'package.json'), 'utf8'));
    const item = packed[index];
    if (
      item.name !== expected.name ||
      item.version !== expected.version ||
      !/^[A-Za-z0-9._-]+\.tgz$/u.test(item.filename)
    )
      throw new Error('Packed package identity does not match the reviewed source.');
    const bytes = await readFile(resolve(output, item.filename));
    if (bytes.length !== item.size)
      throw new Error('Packed archive size does not match its receipt.');
    packages.push({
      name: expected.name,
      version: expected.version,
      file: item.filename,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const receipt = {
    kind: 'openplanr-studio-public-candidate',
    schemaVersion: '1.0.0',
    repository: 'openplanr/OpenPlanr',
    commit,
    packages,
  };
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
