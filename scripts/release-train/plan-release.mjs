#!/usr/bin/env node
// Decide which public packages the checked-out commit still has to publish.
// Usage: node scripts/release-train/plan-release.mjs [--github-output] [--package <name> --version <v>]
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRelease } from './lib/plan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const onlyPackage = flag('--package');
const onlyVersion = flag('--version');

function lookupPublished(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return false;
  const found = result.stdout.trim() ? JSON.parse(result.stdout) : null;
  return found === version;
}

function lookupTag(tag) {
  const output = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    cwd: root,
    encoding: 'utf8',
  });
  return output.trim().length > 0;
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const plan = await planRelease({ root, commit, lookupPublished, lookupTag });

if (onlyPackage && onlyPackage !== 'all-pending') {
  const entry = plan.packages.find((candidate) => candidate.name === onlyPackage);
  if (!entry) throw new Error(`Not a public package: ${onlyPackage}`);
  if (onlyVersion && entry.version !== onlyVersion) {
    throw new Error(`${onlyPackage} is at ${entry.version} on this commit, not ${onlyVersion}`);
  }
  plan.pending = entry.published ? [] : [entry.name];
  plan.releasable = plan.pending.length > 0 && plan.blockers.length === 0;
}

process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
if (args.includes('--github-output') && process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `commit=${plan.commit}`,
      `has_pending=${plan.releasable ? 'true' : 'false'}`,
      `pending=${JSON.stringify(plan.pending)}`,
      `cli_pending=${plan.pending.includes('openplanr') ? 'true' : 'false'}`,
      `blockers=${JSON.stringify(plan.blockers)}`,
      '',
    ].join('\n'),
  );
}
if (plan.blockers.length > 0 && plan.pending.length > 0) {
  process.stderr.write(`Release blocked: ${plan.blockers.join('; ')}\n`);
  process.exit(1);
}
