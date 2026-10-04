import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { readDeterministicZip } from '../../packages/skill-runtime/src/packaging/index.mjs';

const repository = resolve(import.meta.dirname, '../..');
const moduleUrl = (path) => pathToFileURL(join(repository, path)).href;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-package-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts/skills'), { recursive: true });
  mkdirSync(join(root, 'packages/skill-runtime/src/packaging'), { recursive: true });
  mkdirSync(join(root, 'skills'));
  for (const script of ['package-v18-release.mjs', 'plugin-artifact-validation.mjs'])
    copyFileSync(join(repository, 'scripts/skills', script), join(root, 'scripts/skills', script));
  writeFileSync(
    join(root, 'scripts/skills/release-custody.mjs'),
    `export * from '${moduleUrl('scripts/skills/release-custody.mjs')}';\n`,
  );
  writeFileSync(
    join(root, 'scripts/skills/standalone-resources.mjs'),
    'export const buildStandaloneSkillEntries = () => [];\n',
  );
  writeFileSync(
    join(root, 'packages/skill-runtime/src/packaging/index.mjs'),
    `export * from '${moduleUrl('packages/skill-runtime/src/packaging/index.mjs')}';\n`,
  );
  writeFileSync(join(root, 'package.json'), '{"version":"9.9.9"}\n');
  writeFileSync(join(root, 'skills/registry.json'), '{"skills":[]}\n');
  for (const host of ['openai', 'claude', 'cursor']) {
    const plugin = join(root, 'dist/plugins', host, 'openplanr');
    mkdirSync(join(plugin, 'scripts'), { recursive: true });
    writeFileSync(join(plugin, 'README.md'), `# ${host}\n`);
    writeFileSync(join(plugin, 'scripts/run.mjs'), 'console.log("ok");\n', { mode: 0o755 });
  }
  return { root, claude: join(root, 'dist/plugins/claude/openplanr') };
}

const run = (root, mode) =>
  spawnSync(process.execPath, [join(root, 'scripts/skills/package-v18-release.mjs'), mode], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });

test('the Claude archive is built from inspected bytes and modes, deterministically', (t) => {
  const first = fixture(t);
  const second = fixture(t);
  const archive = 'release/archives/openplanr-claude-9.9.9.zip';
  for (const { root } of [first, second]) {
    const written = run(root, '--write');
    assert.equal(written.status, 0, written.stderr);
    const checked = run(root, '--check');
    assert.equal(checked.status, 0, checked.stderr);
  }
  const bytes = readFileSync(join(first.root, archive));
  assert.deepEqual(bytes, readFileSync(join(second.root, archive)));
  const entries = readDeterministicZip(bytes);
  assert.deepEqual(
    entries.map(({ path, mode }) => [path, mode & 0o777]),
    [
      ['openplanr-claude/README.md', 0o644],
      ['openplanr-claude/scripts/run.mjs', 0o755],
    ],
  );
  assert.equal(entries[1].bytes.toString('utf8'), 'console.log("ok");\n');
});

test('oversized, linked and special Claude entries stop packaging before any release output', (t) => {
  const cases = [
    [
      'sparse',
      'file-size',
      (claude) => {
        writeFileSync(join(claude, 'scripts/huge.mjs'), '');
        truncateSync(join(claude, 'scripts/huge.mjs'), 64 * 1024 * 1024);
      },
    ],
    [
      'text',
      'text-size',
      (claude) => writeFileSync(join(claude, 'scripts/large.mjs'), 'x'.repeat(256 * 1024)),
    ],
    [
      'symlink',
      'non-regular-entry',
      (claude) => symlinkSync(join(claude, 'README.md'), join(claude, 'linked.md')),
    ],
    [
      'fifo',
      'non-regular-entry',
      (claude) => execFileSync('mkfifo', [join(claude, 'scripts/pipe.mjs')]),
    ],
  ];
  for (const [name, code, prepare] of cases) {
    const { root, claude } = fixture(t);
    prepare(claude);
    const result = run(root, '--write');
    assert.equal(result.error, undefined, name);
    assert.equal(result.signal, null, name);
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /Plugin artifact validation failed/u, name);
    assert.match(result.stderr, new RegExp(`- ${code}: `, 'u'), name);
    assert.equal(existsSync(join(root, 'release')), false, name);
  }
});

test('other host products keep their packaging rules', (t) => {
  const { root } = fixture(t);
  writeFileSync(
    join(root, 'dist/plugins/cursor/openplanr/scripts/large.mjs'),
    'x'.repeat(256 * 1024),
  );
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
});
