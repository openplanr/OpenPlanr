import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_TARGETS, releaseTag } from './targets.mjs';

/**
 * Decide which public packages the current commit still has to publish.
 * `lookupPublished(name, version)` and `lookupTag(tag)` are injected so the
 * plan can be tested without a registry or a remote.
 */
export async function planRelease({ root, commit, lookupPublished, lookupTag }) {
  const pendingChangesets = readdirSync(join(root, '.changeset')).filter(
    (file) => file.endsWith('.md') && file !== 'README.md',
  );
  const packages = [];
  for (const target of PUBLIC_TARGETS) {
    const manifest = JSON.parse(readFileSync(join(root, target.path, 'package.json'), 'utf8'));
    if (manifest.name !== target.name)
      throw new Error(`${target.path} declares ${manifest.name}, expected ${target.name}`);
    const tag = releaseTag(target.name, manifest.version);
    packages.push({
      name: target.name,
      path: target.path,
      version: manifest.version,
      tag,
      published: await lookupPublished(target.name, manifest.version),
      tagged: await lookupTag(tag),
    });
  }
  const pending = packages.filter((entry) => !entry.published).map((entry) => entry.name);
  const untagged = packages
    .filter((entry) => entry.published && !entry.tagged)
    .map((entry) => entry.name);
  const blockers = [];
  if (pendingChangesets.length > 0) {
    blockers.push(`unconsumed changesets: ${pendingChangesets.join(', ')}`);
  }
  return {
    commit,
    packages,
    pending,
    untagged,
    blockers,
    releasable: pending.length > 0 && blockers.length === 0,
  };
}
