#!/usr/bin/env node
// Create the package-qualified annotated tags and GitHub releases for published bundles.
// Usage: node scripts/release-train/tag-and-release.mjs --bundles <dir> --repo owner/name --run-url <url>
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { payloadDigest, renderReleaseNotes } from './lib/notes.mjs';
import { bundleDirectory, releaseTag, targetByName } from './lib/targets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const bundlesDir = resolve(flag('--bundles', 'release'));
const repo = flag('--repo', process.env.GITHUB_REPOSITORY);
const runUrl = flag('--run-url');
if (!repo || !runUrl)
  throw new Error('Usage: tag-and-release.mjs --bundles <dir> --repo owner/name --run-url <url>');

const { commit, published } = JSON.parse(readFileSync(join(bundlesDir, 'published.json'), 'utf8'));
const gh = (ghArgs, input) =>
  spawnSync('gh', ghArgs, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

function ensureTag(tag, message) {
  const existing = gh(['api', `repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`]);
  if (existing.status === 0) {
    const target = JSON.parse(existing.stdout).object;
    const resolved =
      target.type === 'tag' ? JSON.parse(gh(['api', target.url]).stdout).object.sha : target.sha;
    if (resolved !== commit) throw new Error(`${tag} already points at ${resolved}, not ${commit}`);
    console.log(`${tag} already exists at ${commit.slice(0, 12)}`);
    return;
  }
  const created = gh(
    ['api', `repos/${repo}/git/tags`, '--input', '-'],
    JSON.stringify({ tag, message, object: commit, type: 'commit' }),
  );
  if (created.status !== 0) throw new Error(`Creating tag object ${tag} failed: ${created.stderr}`);
  const ref = gh(
    ['api', `repos/${repo}/git/refs`, '--input', '-'],
    JSON.stringify({
      ref: `refs/tags/${tag}`,
      sha: JSON.parse(created.stdout).sha,
    }),
  );
  if (ref.status !== 0) throw new Error(`Creating ref for ${tag} failed: ${ref.stderr}`);
  console.log(`Created ${tag} at ${commit.slice(0, 12)}`);
}

function ensureRelease(tag, title, notes, latest) {
  if (gh(['release', 'view', tag, '-R', repo]).status === 0) {
    console.log(`Release ${tag} already exists`);
    return;
  }
  const notesFile = join(mkdtempSync(join(tmpdir(), 'openplanr-release-notes-')), 'notes.md');
  writeFileSync(notesFile, notes);
  const created = gh([
    'release',
    'create',
    tag,
    '-R',
    repo,
    '--verify-tag',
    '--title',
    title,
    '--notes-file',
    notesFile,
    latest ? '--latest' : '--latest=false',
  ]);
  if (created.status !== 0) throw new Error(`Creating release ${tag} failed: ${created.stderr}`);
  console.log(created.stdout.trim());
}

for (const entry of published) {
  const target = targetByName(entry.name);
  const tag = releaseTag(entry.name, entry.version);
  const runId = runUrl.split('/').filter(Boolean).pop();
  ensureTag(
    tag,
    `${entry.name} ${entry.version} — published ${entry.publishedAt.slice(0, 10)} by publish-packages.yml run ${runId}; archive verified against this commit`,
  );
  const archive = join(bundlesDir, bundleDirectory(entry.name), entry.filename);
  const { fileCount } = payloadDigest(archive);
  const notes = renderReleaseNotes({
    changelog: readFileSync(join(root, target.path, 'CHANGELOG.md'), 'utf8'),
    name: entry.name,
    version: entry.version,
    integrity: entry.integrity,
    publishedAt: entry.publishedAt,
    runUrl,
    commit,
    fileCount,
    bundled: entry.publicDependencies?.['planr-pipeline']
      ? `planr-pipeline@${entry.publicDependencies['planr-pipeline']}`
      : null,
  });
  ensureRelease(tag, `${entry.name} ${entry.version}`, notes, target.tagLatestRelease);
}
execFileSync('git', ['fetch', '--tags', '--quiet', 'origin'], {
  cwd: root,
  stdio: 'ignore',
});
