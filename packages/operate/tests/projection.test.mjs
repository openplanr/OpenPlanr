import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '..', '..');
const projector = join(workspaceRoot, 'scripts', 'domains', 'project-domains.mjs');

function walk(root) {
  const paths = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else paths.push({ path, entry });
    }
  };
  visit(root);
  return paths;
}

test('domain projections are deterministic, private-package-free ordinary files', () => {
  const target = mkdtempSync(join(tmpdir(), 'openplanr-domain-projection-'));
  execFileSync(process.execPath, [projector, '--write', '--target', target], { stdio: 'pipe' });
  const check = JSON.parse(
    execFileSync(process.execPath, [projector, '--check', '--target', target], {
      encoding: 'utf8',
    }),
  );
  assert.equal(check.ok, true);
  assert.equal(check.manifestFiles, 3);
  assert.equal(check.driftFiles, 0);
  const projectedFiles = check.domains.reduce((total, domain) => {
    const manifest = JSON.parse(
      readFileSync(
        join(target, 'lib', 'generated', 'domain-projections', `${domain}.json`),
        'utf8',
      ),
    );
    assert.equal(manifest.domain, domain);
    return total + manifest.entries.length;
  }, 0);
  assert.equal(check.projectedFiles, projectedFiles);
  for (const { path, entry } of walk(target)) {
    assert.equal(entry.isSymbolicLink(), false, path);
    if (/\.(?:mjs|mts)$/u.test(path)) {
      assert.doesNotMatch(readFileSync(path, 'utf8'), /(['"])@openplanr\//u, path);
    }
  }

  const staleTarget = join(target, 'lib', 'operate', 'retired-projection.mjs');
  const manifestPath = join(target, 'lib', 'generated', 'domain-projections', 'operate.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(staleTarget, 'export const retired = true;\n');
  manifest.entries.push({
    source: 'packages/operate/lib/operate/retired-projection.mjs',
    target: 'lib/operate/retired-projection.mjs',
    sha256: '0'.repeat(64),
    mode: '644',
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const staleCheck = spawnSync(process.execPath, [projector, '--check', '--target', target], {
    encoding: 'utf8',
  });
  assert.equal(staleCheck.status, 1);
  assert.equal(
    JSON.parse(staleCheck.stdout).drift.some((entry) => entry.stale === true),
    true,
  );
  execFileSync(process.execPath, [projector, '--write', '--target', target], { stdio: 'pipe' });
  assert.equal(existsSync(staleTarget), false);
});
