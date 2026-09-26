import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluationContentDigest } from '../../lib/pipeline/evaluation-identity.mjs';
import {
  PROFESSIONAL_SKILLS_MANIFEST_PATH,
  readProfessionalSkillsCatalog,
  renderProfessionalSkillAssets,
  renderProfessionalSkillsBundle,
} from '../../lib/pipeline/professional-skills.mjs';
import {
  assertNoSiblingDiscovery,
  buildDeclaredArchive,
  compareGeneratedAssets,
  comparePackageExports,
  comparePackedMembership,
  packageFilesCover,
} from '../../lib/evaluation/parity.mjs';

const root = dirname(fileURLToPath(new URL('../../package.json', import.meta.url)));
const sourceRoot = resolve(root, '../..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('the frozen compatibility manifest matches bundled legacy snapshots', () => {
  const parity = compareGeneratedAssets({ repoRoot: root, sourceRoot });
  assert.deepEqual([...parity.mismatches], []);
  assert.equal(parity.present, parity.declared);
  assert.equal(parity.declared, 1);
});

test('parity compares exact bytes, not a version string', () => {
  const generated = renderProfessionalSkillsBundle({ projectRoot: root, view: 'legacy' });
  const path = PROFESSIONAL_SKILLS_MANIFEST_PATH;
  const bytes = generated[path];
  assert.equal(
    evaluationContentDigest(readFileSync(join(root, path))),
    evaluationContentDigest(bytes),
  );
  assert.notEqual(evaluationContentDigest(`${bytes} `), evaluationContentDigest(bytes));
});

test('every declared package export resolves to real bytes', () => {
  const parity = comparePackageExports({ repoRoot: root, sourceRoot, packageJson });
  assert.deepEqual([...parity.mismatches], []);
  assert.equal(parity.present, parity.declared);
});

test('an export that resolves to nothing is a parity failure', () => {
  const parity = comparePackageExports({
    repoRoot: root,
    packageJson: { exports: { './absent': { import: './lib/evaluation/absent-module.mjs' } } },
  });
  assert.equal(parity.declared, 1);
  assert.equal(parity.present, 0);
  assert.equal(parity.mismatches[0].subpath, './absent');
});

test('package-owned evaluation metadata is covered by the packed inventory', () => {
  const parity = comparePackedMembership({ repoRoot: root, sourceRoot, packageJson });
  assert.deepEqual([...parity.mismatches], []);
  assert.equal(parity.present, parity.declared);
  assert.equal(parity.declared, 2);
});

test('evaluation metadata the archive would not carry is a package parity failure', () => {
  const parity = comparePackedMembership({
    repoRoot: root,
    sourceRoot,
    packageJson: { ...packageJson, files: ['lib/'] },
  });
  assert.ok(parity.mismatches.length > 0);
  assert.ok(parity.mismatches.every((entry) => entry.reason === 'not-covered-by-packed-files'));
  assert.equal(parity.present, 0);
});

test('installed bytes that diverge from the source are a package parity failure', () => {
  const parity = comparePackedMembership({
    repoRoot: root,
    sourceRoot,
    packageJson,
    installedRoot: join(root, 'conformance'),
  });
  assert.ok(parity.mismatches.length > 0);
  assert.ok(parity.mismatches.every((entry) => entry.reason === 'installed-bytes-diverged'));
});

test('packed file coverage distinguishes a directory prefix from an exact member', () => {
  assert.equal(packageFilesCover(['skills/'], 'skills/planr-spec/SKILL.md'), true);
  assert.equal(packageFilesCover(['skills/'], 'adapters/codex/skills/planr-spec/SKILL.md'), false);
  assert.equal(packageFilesCover(['README.md'], 'README.md'), true);
  assert.equal(packageFilesCover(['README.md'], 'README.md.bak'), false);
});

test('the pipeline package excludes host prompt distributions', () => {
  for (const entry of ['skills/', 'adapters/', 'agents/', 'commands/', 'plugins/']) {
    assert.equal(
      packageJson.files.some((member) => member === entry || member.startsWith(entry)),
      false,
      entry,
    );
  }
});

test('the declared archive carries the exact generated assets', () => {
  const archive = buildDeclaredArchive({ repoRoot: root, sourceRoot });
  const generated = renderProfessionalSkillAssets(
    readProfessionalSkillsCatalog({ projectRoot: root, view: 'active', sourceRoot }),
  );
  assert.deepEqual(Object.keys(archive).sort(), Object.keys(generated).sort());
  for (const [path, bytes] of Object.entries(archive)) assert.equal(bytes, generated[path]);
});

test('a declared member that would leave the installation root is refused', () => {
  assert.equal(
    assertNoSiblingDiscovery('/tmp/install-root', ['skills/planr-spec/SKILL.md']),
    '/tmp/install-root',
  );
  assert.throws(
    () => assertNoSiblingDiscovery('/tmp/install-root', ['../sibling-checkout/skills/SKILL.md']),
    { code: 'E_EVALUATION_PACKED_MEMBER_REFUSED' },
  );
});
