import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-publication-custody-'));
  const root = join(temporary, 'source');
  const protocol = join(root, 'packages/protocol');
  mkdirSync(join(protocol, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, '.changeset'));
  writeFileSync(join(root, '.changeset/README.md'), 'Release notes\n');
  writeFileSync(join(root, '.gitignore'), 'packages/protocol/src/private.mjs\n');
  copyFileSync(
    join(repository, 'scripts/prepare-publication.mjs'),
    join(root, 'scripts/prepare-publication.mjs'),
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'publication-fixture',
      private: true,
      workspaces: ['packages/protocol'],
    }),
  );
  writeFileSync(
    join(protocol, 'package.json'),
    JSON.stringify({
      name: '@openplanr/protocol',
      version: '0.2.0',
      type: 'module',
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/openplanr/OpenPlanr.git' },
      files: ['src/'],
    }),
  );
  writeFileSync(join(protocol, 'src/index.mjs'), 'export const version = "fixture";\n');
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Publication test'],
    ['config', 'user.email', 'publication-test@example.invalid'],
    ['add', '.'],
    ['commit', '-qm', 'Create reviewed publication fixture'],
  ])
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  return { temporary, root, protocol };
}

function prepare({ root, temporary }, output = join(temporary, 'publication')) {
  return spawnSync(process.execPath, [join(root, 'scripts/prepare-publication.mjs'), output], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      RELEASE_PACKAGE: '@openplanr/protocol',
      RELEASE_VERSION: '0.2.0',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
}

test('publication archives only the exact reviewed Git source and records its commit', () => {
  const f = fixture();
  try {
    const result = prepare(f);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(
      readFileSync(join(f.temporary, 'publication/publication.json'), 'utf8'),
    );
    assert.equal(proof.name, '@openplanr/protocol');
    assert.equal(proof.version, '0.2.0');
    assert.equal(
      proof.commit,
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim(),
    );
    assert.match(proof.sha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('publication rejects untracked and ignored source injections', () => {
  for (const [file, error] of [
    ['unexpected.mjs', /untracked files before publication/u],
    ['private.mjs', /not a reviewed source or declared build output: src\/private.mjs/u],
  ]) {
    const f = fixture();
    try {
      writeFileSync(join(f.protocol, 'src', file), 'export const confidential = true;\n');
      const result = prepare(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, error);
    } finally {
      rmSync(f.temporary, { recursive: true, force: true });
    }
  }
});

test('publication requires consumed changesets and an output outside the source tree', () => {
  const f = fixture();
  try {
    assert.match(prepare(f, join(f.root, 'output')).stderr, /outside the source checkout/u);
    writeFileSync(
      join(f.root, '.changeset/pending.md'),
      '---\n"@openplanr/protocol": minor\n---\nPending change\n',
    );
    const result = prepare(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Consume and review Changesets/u);
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('every isolated packed CI runner installs the declared Protocol browser dependency', () => {
  const workflow = readFileSync(join(repository, '.github/workflows/ci.yml'), 'utf8');
  const packed = workflow.slice(workflow.indexOf('  packed-public-packages:'));
  assert.match(packed, /node: \[20, 22, 24\]/u);
  const browser = packed.indexOf(
    'npm exec --workspace=@openplanr/protocol -- playwright install --with-deps chromium',
  );
  const proof = packed.indexOf('npm run verify:packed:strict');
  assert.ok(
    browser > 0 && proof > browser,
    'Packed CI must install its own browser before consumer execution',
  );
});

function pipelineFixture() {
  const f = fixture();
  const pipeline = join(f.root, 'packages/pipeline');
  mkdirSync(join(pipeline, 'lib/artifact'), { recursive: true });
  mkdirSync(join(pipeline, 'lib/generated/domain-projections'), { recursive: true });
  mkdirSync(join(f.root, 'scripts/protocol'), { recursive: true });
  mkdirSync(join(f.root, 'scripts/domains'), { recursive: true });
  mkdirSync(join(f.protocol, 'scripts'), { recursive: true });
  const workspace = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8'));
  workspace.workspaces.push('packages/pipeline');
  writeFileSync(join(f.root, 'package.json'), JSON.stringify(workspace));
  writeFileSync(
    join(pipeline, 'package.json'),
    JSON.stringify({
      name: 'planr-pipeline',
      version: '0.49.1',
      type: 'module',
      license: 'MIT',
      repository: 'git+https://github.com/openplanr/OpenPlanr.git',
      files: ['lib/'],
    }),
  );
  const canonical = 'export const renderer = "reviewed source";\n';
  writeFileSync(join(f.protocol, 'src/renderer.mjs'), canonical);
  writeFileSync(join(pipeline, 'lib/artifact/renderer.mjs'), canonical);
  const digest = createHash('sha256').update(canonical).digest('hex');
  const manifest = {
    entries: [
      {
        source: 'packages/protocol/src/renderer.mjs',
        target: 'lib/artifact/renderer.mjs',
        sha256: digest,
        mode: '644',
      },
    ],
  };
  const manifestFile = 'lib/generated/domain-projections/artifact.json';
  writeFileSync(join(pipeline, manifestFile), JSON.stringify(manifest));
  for (const path of [
    'lib/generated/protocol-projection.json',
    'lib/generated/domain-projections/design.json',
    'lib/generated/domain-projections/operate.json',
  ]) {
    writeFileSync(join(pipeline, path), JSON.stringify({ entries: [] }));
  }
  // The fixture's tracked generator stands in for a reproducible build. Altering
  // ignored output or its claimed manifest must not turn it into reviewed input.
  const checker = `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
assert.equal(readFileSync('packages/pipeline/lib/artifact/renderer.mjs','utf8'),readFileSync('packages/protocol/src/renderer.mjs','utf8'));
assert.deepEqual(JSON.parse(readFileSync('packages/pipeline/${manifestFile}','utf8')),${JSON.stringify(manifest)});\n`;
  for (const script of [
    'scripts/protocol/project-protocol.mjs',
    'scripts/domains/project-domains.mjs',
    'packages/protocol/scripts/generate-protocol-assets.mjs',
  ])
    writeFileSync(join(f.root, script), checker);
  writeFileSync(join(f.root, '.gitignore'), 'packages/pipeline/lib/artifact/\n');
  execFileSync('git', ['add', '.'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'Declare reproducible package outputs'], { cwd: f.root });
  return { ...f, pipeline };
}

function preparePipeline(f, environment = {}) {
  return spawnSync(
    process.execPath,
    [join(f.root, 'scripts/prepare-publication.mjs'), join(f.temporary, 'publication')],
    {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        RELEASE_PACKAGE: 'planr-pipeline',
        RELEASE_VERSION: '0.49.1',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        ...environment,
      },
    },
  );
}

test('publication includes reproduced pipeline outputs without tracking duplicate bytes', () => {
  const f = pipelineFixture();
  try {
    const result = preparePipeline(f);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(
      readFileSync(join(f.temporary, 'publication/publication.json'), 'utf8'),
    );
    const files = execFileSync('tar', ['-tzf', join(f.temporary, 'publication', proof.filename)], {
      encoding: 'utf8',
    });
    assert.match(files, /package\/lib\/artifact\/renderer.mjs/u);
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('publication rejects an ignored extra file inside a generated pipeline directory', () => {
  const f = pipelineFixture();
  try {
    writeFileSync(
      join(f.pipeline, 'lib/artifact/private.mjs'),
      'export const confidential = true;\n',
    );
    const result = preparePipeline(f);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /not a reviewed source or declared build output: lib\/artifact\/private.mjs/u,
    );
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('publication rejects modified generated bytes even in an otherwise clean checkout', () => {
  const f = pipelineFixture();
  try {
    writeFileSync(
      join(f.pipeline, 'lib/artifact/renderer.mjs'),
      'export const renderer = "unreviewed";\n',
    );
    const result = preparePipeline(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERR_ASSERTION|AssertionError/u);
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

// Interpose only the packing executable so the mutation happens after generator
// checks, without timing assumptions or changes to the reviewed source.
test('publication rejects generated bytes changed or removed during packing', () => {
  for (const mutation of ['rewrite', 'remove']) {
    const f = pipelineFixture();
    try {
      const npm = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
      const wrapper = join(f.temporary, 'bin');
      mkdirSync(wrapper);
      const mutate = join(f.temporary, 'mutate.mjs');
      const target = join(f.pipeline, 'lib/artifact/renderer.mjs');
      writeFileSync(
        mutate,
        mutation === 'rewrite'
          ? `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(target)}, 'export const renderer = "changed during pack";');`
          : `import { unlinkSync } from 'node:fs'; unlinkSync(${JSON.stringify(target)});`,
      );
      const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
      writeFileSync(
        join(wrapper, 'npm'),
        `#!/bin/sh\n${quote(process.execPath)} ${quote(mutate)}\nexec ${quote(npm)} "$@"\n`,
      );
      chmodSync(join(wrapper, 'npm'), 0o755);
      const result = preparePipeline(f, { PATH: `${wrapper}:${process.env.PATH}` });
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /Generated archive bytes changed or missing: lib\/artifact\/renderer.mjs/u,
      );
    } finally {
      rmSync(f.temporary, { recursive: true, force: true });
    }
  }
});
