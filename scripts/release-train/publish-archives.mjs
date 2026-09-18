#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
// Publish verified bundles in dependency order through npm trusted publishing.
// Usage: node scripts/release-train/publish-archives.mjs --bundles <dir> --tag latest|next --commit <sha>
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleDirectory, PUBLIC_TARGETS } from './lib/targets.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const bundlesDir = resolve(flag('--bundles', 'release'));
const tag = flag('--tag', 'latest');
const commit = flag('--commit', process.env.GITHUB_SHA);
const dependencyBudgetMs = Number(flag('--dependency-budget-ms', 20 * 60_000));
const propagationBudgetMs = Number(flag('--propagation-budget-ms', 15 * 60_000));
if (!['latest', 'next'].includes(tag)) throw new Error('Distribution tag must be latest or next');
if (!/^[0-9a-f]{40}$/u.test(commit ?? '')) throw new Error('A full source commit sha is required');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function npmView(spec, field) {
  const result = spawnSync('npm', ['view', spec, field, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function registryIntegrity(name, version) {
  const integrity = npmView(`${name}@${version}`, 'dist.integrity');
  if (integrity === null) return null;
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) {
    throw new Error(`Registry returned invalid integrity for ${name}@${version}`);
  }
  return integrity;
}

function assertNpmVersion() {
  const [major, minor, patch] = execFileSync('npm', ['--version'], {
    encoding: 'utf8',
  })
    .trim()
    .split('.')
    .map(Number);
  if (major < 11 || (major === 11 && (minor < 5 || (minor === 5 && patch < 1)))) {
    throw new Error('npm >=11.5.1 is required for trusted publishing');
  }
}

async function waitForDependency(name, version) {
  const deadline = Date.now() + dependencyBudgetMs;
  for (;;) {
    if (npmView(`${name}@${version}`, 'version') === version) return;
    if (Date.now() > deadline)
      throw new Error(`Publish ${name}@${version} before its dependents; it is not visible on npm`);
    console.log(`Waiting for ${name}@${version} to appear on npm`);
    await sleep(15_000);
  }
}

async function publishBundle(target) {
  const dir = join(bundlesDir, bundleDirectory(target.name));
  const proof = JSON.parse(readFileSync(join(dir, 'publication.json'), 'utf8'));
  if (
    proof.name !== target.name ||
    proof.commit !== commit ||
    !/^[a-zA-Z0-9._-]+\.tgz$/u.test(proof.filename)
  ) {
    throw new Error(`Publication identity mismatch for ${target.name}`);
  }
  const archive = join(dir, proof.filename);
  const bytes = readFileSync(archive);
  if (createHash('sha256').update(bytes).digest('hex') !== proof.sha256)
    throw new Error(`Archive digest mismatch for ${target.name}`);
  for (const [dependency, version] of Object.entries(proof.publicDependencies))
    await waitForDependency(dependency, version);

  const candidateIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const classify = () => {
    const integrity = registryIntegrity(proof.name, proof.version);
    if (integrity === null) return 'absent';
    if (integrity === candidateIntegrity) return 'identical';
    throw new Error(`${proof.name}@${proof.version} already exists with different bytes`);
  };

  let skipped = false;
  if (classify() === 'identical') {
    console.log(`${proof.name}@${proof.version} already has the reviewed bytes; skipping publish`);
    skipped = true;
  } else {
    const publish = spawnSync(
      'npm',
      ['publish', archive, '--ignore-scripts', '--access', 'public', '--provenance', '--tag', tag],
      { stdio: 'inherit' },
    );
    const deadline = Date.now() + (publish.status === 0 ? propagationBudgetMs : 15_000);
    let visible = false;
    while (!visible) {
      visible = classify() === 'identical';
      if (visible) break;
      if (Date.now() > deadline) break;
      await sleep(10_000);
    }
    if (!visible) {
      throw new Error(
        publish.status === 0
          ? `${proof.name}@${proof.version} publish succeeded but npm did not expose the reviewed bytes`
          : `npm publish failed for ${proof.name}@${proof.version} (exit ${publish.status ?? 'signal'})`,
      );
    }
  }
  const time = npmView(proof.name, 'time') ?? {};
  return {
    name: proof.name,
    version: proof.version,
    filename: proof.filename,
    sha256: proof.sha256,
    integrity: candidateIntegrity,
    publishedAt: time[proof.version] ?? new Date().toISOString(),
    publicDependencies: proof.publicDependencies,
    tag,
    skipped,
  };
}

assertNpmVersion();
const published = [];
for (const target of PUBLIC_TARGETS) {
  if (!existsSync(join(bundlesDir, bundleDirectory(target.name), 'publication.json'))) continue;
  published.push(await publishBundle(target));
}
if (published.length === 0) throw new Error('No publication bundles found');
writeFileSync(
  join(bundlesDir, 'published.json'),
  `${JSON.stringify({ commit, published }, null, 2)}\n`,
);
console.log(
  published
    .map(
      (entry) =>
        `${entry.name}@${entry.version} ${entry.skipped ? 'already published' : 'published'} (${entry.integrity})`,
    )
    .join('\n'),
);
