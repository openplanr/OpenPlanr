import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputs = {
  'packages/canvas/src/index.mjs': 'export {};\n',
  'packages/canvas/src/index.d.mts': 'export {};\n',
};

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-canvas-publication-'));
  const root = join(temporary, 'source');
  for (const directory of [
    'packages/canvas/src',
    'scripts/skills',
    'scripts/typescript',
    '.changeset',
  ])
    mkdirSync(join(root, directory), { recursive: true });
  copyFileSync(
    join(repository, 'scripts/prepare-publication.mjs'),
    join(root, 'scripts/prepare-publication.mjs'),
  );
  for (const helper of ['cli-resources.mjs', 'plugin-artifact-validation.mjs'])
    copyFileSync(join(repository, 'scripts/skills', helper), join(root, 'scripts/skills', helper));
  writeFileSync(join(root, '.changeset/README.md'), '# Changesets\n');
  writeFileSync(join(root, 'packages/canvas/.gitignore'), '/src/**/*.mjs\n/src/**/*.d.mts\n');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/canvas'] }),
  );
  writeFileSync(
    join(root, 'packages/canvas/package.json'),
    JSON.stringify({
      name: '@openplanr/canvas',
      version: '0.1.0',
      type: 'module',
      license: 'MIT',
      repository: 'git+https://github.com/openplanr/OpenPlanr.git',
      files: ['src/**/*.mjs', 'src/**/*.d.mts'],
    }),
  );
  writeFileSync(join(root, 'packages/canvas/src/index.mts'), 'export {};\n');
  writeFileSync(
    join(root, 'scripts/typescript/compile-sources.mjs'),
    `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export function renderTypeScriptOutputs({ root }) {
  assert.equal(readFileSync(root + '/packages/canvas/src/index.mts', 'utf8'), 'export {};\\n');
  return ${JSON.stringify(outputs)};
}\n`,
  );
  for (const [target, bytes] of Object.entries(outputs)) writeFileSync(join(root, target), bytes);
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Publication test'],
    ['config', 'user.email', 'publication-test@example.invalid'],
    ['config', 'gc.auto', '0'],
    ['config', 'maintenance.auto', 'false'],
    ['add', '.'],
    ['commit', '-qm', 'Create reviewed canvas publication fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  return { root, temporary };
}

function prepare({ root, temporary }, environment = {}) {
  return spawnSync(
    process.execPath,
    [join(root, 'scripts/prepare-publication.mjs'), join(temporary, 'publication')],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        RELEASE_PACKAGE: '@openplanr/canvas',
        RELEASE_VERSION: '0.1.0',
        npm_config_cache: join(temporary, 'npm-cache'),
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        ...environment,
      },
    },
  );
}

test('canvas publication accepts only compiler-owned ignored modules and declarations', () => {
  const f = fixture();
  try {
    const result = prepare(f);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(
      readFileSync(join(f.temporary, 'publication/publication.json'), 'utf8'),
    );
    assert.equal(proof.name, '@openplanr/canvas');
    assert.equal(proof.version, '0.1.0');
    const files = execFileSync('tar', ['-tzf', join(f.temporary, 'publication', proof.filename)], {
      encoding: 'utf8',
    });
    for (const target of Object.keys(outputs))
      assert.ok(files.includes(`package/${target.slice('packages/canvas/'.length)}\n`));
    assert.ok(!files.includes('package/src/index.mts\n'));
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('canvas publication rejects stale modules and declarations before packing', () => {
  for (const target of Object.keys(outputs)) {
    const f = fixture();
    try {
      writeFileSync(join(f.root, target), 'export const stale = true;\n');
      const result = prepare(f);
      assert.notEqual(result.status, 0);
      assert.ok(
        result.stderr.includes(`Generated package bytes changed: ${target}`),
        result.stderr,
      );
    } finally {
      rmSync(f.temporary, { recursive: true, force: true });
    }
  }
});

test('canvas publication rejects extra ignored modules and declarations', () => {
  for (const target of ['src/private.mjs', 'src/private.d.mts']) {
    const f = fixture();
    try {
      writeFileSync(join(f.root, 'packages/canvas', target), 'export {};\n');
      const result = prepare(f);
      assert.notEqual(result.status, 0);
      assert.ok(
        result.stderr.includes(
          `Packed file is not a reviewed source or declared build output: ${target}`,
        ),
        result.stderr,
      );
    } finally {
      rmSync(f.temporary, { recursive: true, force: true });
    }
  }
});

test('canvas publication rejects generated declarations changed during packing', () => {
  const f = fixture();
  try {
    const npm = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
    const wrapper = join(f.temporary, 'bin');
    mkdirSync(wrapper);
    const mutate = join(f.temporary, 'mutate.mjs');
    writeFileSync(
      mutate,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(f.root, 'packages/canvas/src/index.d.mts'))}, 'export declare const changed: true;');\n`,
    );
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(
      join(wrapper, 'npm'),
      `#!/bin/sh\n${quote(process.execPath)} ${quote(mutate)}\nexec ${quote(npm)} "$@"\n`,
    );
    chmodSync(join(wrapper, 'npm'), 0o755);
    const result = prepare(f, { PATH: `${wrapper}:${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Generated archive bytes changed or missing: src\/index.d.mts/u);
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});
