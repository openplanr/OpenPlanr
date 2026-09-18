import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/** The `## <version>` section of a Changesets changelog, heading included. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
  let end = start + 1;
  while (end < lines.length && !/^## /u.test(lines[end])) end += 1;
  return `${lines.slice(start, end).join('\n').trimEnd()}\n`;
}

function formatUtc(iso) {
  return iso
    .replace('T', ' ')
    .replace(/\.\d+Z$/u, '')
    .replace(/Z$/u, '');
}

/** GitHub release body: the changelog section plus the publication evidence block. */
export function renderReleaseNotes({
  changelog,
  name,
  version,
  integrity,
  publishedAt,
  runUrl,
  commit,
  fileCount,
  bundled,
}) {
  const npmUrl = `https://www.npmjs.com/package/${name}/v/${version}`;
  const bundledNote = bundled ? `; bundles \`${bundled}\`` : '';
  const files = fileCount.toLocaleString('en-US');
  return [
    changelogSection(changelog, version),
    '## Publication',
    `- npm: ${npmUrl} — integrity \`${integrity}\`${bundledNote}`,
    `- Published ${formatUtc(publishedAt)} UTC by \`publish-packages.yml\` run ${runUrl} with a SLSA v1 attestation for source commit \`${commit}\` (this tag). The archive was packed from that commit in the same run and its bytes are the ones the registry serves, ${files}/${files} files.`,
    '',
  ].join('\n');
}

/** SHA-256 of the sorted per-file SHA-256 list of an archive. */
export function payloadDigest(archivePath) {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-payload-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', dir]);
    const base = join(dir, 'package');
    const files = [];
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(full);
      }
    };
    walk(base);
    const lines = files
      .map(
        (file) =>
          `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ./${relative(base, file)}`,
      )
      .sort((left, right) =>
        left.slice(66) < right.slice(66) ? -1 : left.slice(66) > right.slice(66) ? 1 : 0,
      );
    return {
      fileCount: files.length,
      digest: createHash('sha256')
        .update(`${lines.join('\n')}\n`)
        .digest('hex'),
      bytes: files.reduce((total, file) => total + statSync(file).size, 0),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
