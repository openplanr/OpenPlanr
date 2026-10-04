import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { load } from 'js-yaml';
import { CLI_GENERATED_RESOURCES } from '../../scripts/skills/cli-resources.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-publication-custody-'));
  const root = join(temporary, 'source');
  const protocol = join(root, 'packages/protocol');
  mkdirSync(join(protocol, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'scripts/skills'));
  mkdirSync(join(root, '.changeset'));
  writeFileSync(join(root, '.changeset/README.md'), 'Release notes\n');
  writeFileSync(join(root, '.gitignore'), 'packages/protocol/src/private.mjs\n');
  copyFileSync(
    join(repository, 'scripts/prepare-publication.mjs'),
    join(root, 'scripts/prepare-publication.mjs'),
  );
  copyFileSync(
    join(repository, 'scripts/skills/cli-resources.mjs'),
    join(root, 'scripts/skills/cli-resources.mjs'),
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

function prepare(
  { root, temporary },
  output = join(temporary, 'publication'),
  { packageName = '@openplanr/protocol', version = '0.2.0', environment = {} } = {},
) {
  return spawnSync(process.execPath, [join(root, 'scripts/prepare-publication.mjs'), output], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      RELEASE_PACKAGE: packageName,
      RELEASE_VERSION: version,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...environment,
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

function cliFixture() {
  const f = fixture();
  const cli = join(f.root, 'packages/cli');
  mkdirSync(join(cli, 'lib'), { recursive: true });
  mkdirSync(join(f.root, 'scripts/typescript'));
  const workspace = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8'));
  workspace.workspaces.push('packages/cli');
  writeFileSync(join(f.root, 'package.json'), JSON.stringify(workspace));
  writeFileSync(
    join(cli, 'package.json'),
    JSON.stringify({
      name: 'openplanr',
      version: '2.0.0',
      type: 'module',
      license: 'MIT',
      repository: 'git+https://github.com/openplanr/OpenPlanr.git',
      files: ['lib/'],
    }),
  );
  const writer = 'packages/artifact/lib/artifact/internal/credential-writer.mts';
  mkdirSync(dirname(join(f.root, writer)), { recursive: true });
  writeFileSync(join(f.root, writer), 'export const writer = "reviewed";\n');
  const expected = Object.fromEntries(
    CLI_GENERATED_RESOURCES.map(({ source }) => [
      source,
      source.endsWith('.d.mts')
        ? 'export declare const value: string;\n'
        : 'export const value = "reviewed";\n',
    ]),
  );
  for (const { source, destination } of CLI_GENERATED_RESOURCES) {
    mkdirSync(dirname(join(f.root, source)), { recursive: true });
    writeFileSync(join(f.root, source), expected[source]);
    writeFileSync(join(f.root, destination), expected[source]);
  }
  // Deterministic tracked checkers stand in for compilation and projection.
  // An ignored output cannot justify its own admission into a release archive.
  const compiler = `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
export function renderTypeScriptOutputs() {
assert.equal(readFileSync(${JSON.stringify(writer)},'utf8'),'export const writer = "reviewed";\\n');
const expected = ${JSON.stringify(expected)};
for (const [source, bytes] of Object.entries(expected)) assert.equal(readFileSync(source,'utf8'),bytes);
return Object.fromEntries(Object.entries(expected).filter(([source]) => source.startsWith('packages/artifact/')));
}\n`;
  const projector = `import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
import { CLI_GENERATED_RESOURCES } from './cli-resources.mjs';
for (const {source,destination} of CLI_GENERATED_RESOURCES) assert.deepEqual(readFileSync(source),readFileSync(destination));\n`;
  writeFileSync(join(f.root, 'scripts/typescript/compile-sources.mjs'), compiler);
  writeFileSync(join(f.root, 'scripts/skills/generate-v18.mjs'), projector);
  writeFileSync(
    join(f.root, '.gitignore'),
    'packages/cli/lib/\npackages/artifact/lib/artifact/internal/*.mjs\npackages/artifact/lib/artifact/internal/*.d.mts\n',
  );
  execFileSync('git', ['add', '.'], { cwd: f.root });
  execFileSync('git', ['commit', '-qm', 'Declare compiled CLI projections'], { cwd: f.root });
  return { ...f, cli };
}

function prepareCli(f, environment = {}) {
  return prepare(f, join(f.temporary, 'publication'), {
    packageName: 'openplanr',
    version: '2.0.0',
    environment,
  });
}

test('publication includes compiled CLI helpers and their declarations', () => {
  const f = cliFixture();
  try {
    const result = prepareCli(f);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(readFileSync(join(f.temporary, 'publication/publication.json')));
    const files = execFileSync('tar', ['-tzf', join(f.temporary, 'publication', proof.filename)], {
      encoding: 'utf8',
    });
    for (const { destination } of CLI_GENERATED_RESOURCES)
      assert.ok(files.includes(`package/${destination.slice('packages/cli/'.length)}\n`));
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('publication rejects ignored extra CLI helpers and drifted compiled projections', () => {
  for (const [target, error] of [
    ['packages/cli/lib/private.mjs', /not a reviewed source or declared build output/u],
    ['packages/cli/lib/credential-writer.d.mts', /AssertionError/u],
    ['packages/artifact/lib/artifact/internal/credential-writer.mjs', /AssertionError/u],
  ]) {
    const f = cliFixture();
    try {
      writeFileSync(join(f.root, target), 'export const confidential = true;\n');
      const result = prepareCli(f);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, error);
    } finally {
      rmSync(f.temporary, { recursive: true, force: true });
    }
  }
});

test('publication rejects CLI projection bytes changed during packing', () => {
  const f = cliFixture();
  try {
    const npm = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
    const wrapper = join(f.temporary, 'bin');
    mkdirSync(wrapper);
    const mutate = join(f.temporary, 'mutate.mjs');
    writeFileSync(
      mutate,
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(f.cli, 'lib/credential-writer.d.mts'))}, 'export declare const changed: true;');`,
    );
    const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(
      join(wrapper, 'npm'),
      `#!/bin/sh\n${quote(process.execPath)} ${quote(mutate)}\nexec ${quote(npm)} "$@"\n`,
    );
    chmodSync(join(wrapper, 'npm'), 0o755);
    const result = prepareCli(f, { PATH: `${wrapper}:${process.env.PATH}` });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Generated archive bytes changed or missing: lib\/credential-writer.d.mts/u,
    );
  } finally {
    rmSync(f.temporary, { recursive: true, force: true });
  }
});

test('publication keeps compiled expectations when ignored source and projection change together', () => {
  const f = cliFixture();
  try {
    const projector = join(f.root, 'scripts/skills/generate-v18.mjs');
    writeFileSync(
      projector,
      readFileSync(projector, 'utf8') +
        `import { writeFileSync } from 'node:fs';
for (const path of ['packages/artifact/lib/artifact/internal/credential-writer.mjs', 'packages/cli/lib/credential-writer.mjs']) writeFileSync(path,'export const injected = true;');\n`,
    );
    execFileSync('git', ['add', 'scripts/skills/generate-v18.mjs'], { cwd: f.root });
    execFileSync('git', ['commit', '-qm', 'Reproduce output mutation after compilation'], {
      cwd: f.root,
    });
    const result = prepareCli(f);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Generated package bytes changed: packages\/cli\/lib\/credential-writer.mjs/u,
    );
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

test('CI prepares contributor tooling before switching to published consumer runtimes', () => {
  const workflow = (name) =>
    load(readFileSync(join(repository, '.github/workflows', name), 'utf8'));
  const setups = (job) =>
    job.steps.flatMap((step, index) =>
      step.uses?.startsWith('actions/setup-node@')
        ? [{ index, version: String(step.with['node-version']) }]
        : [],
    );
  for (const [name, id] of [
    ['dashboard-browser.yml', 'browser-tests'],
    ['artifact-browser.yml', 'hostile-sandbox'],
  ]) {
    assert.deepEqual(
      setups(workflow(name).jobs[id]).map(({ version }) => version),
      ['24'],
      name,
    );
  }
  const ci = workflow('ci.yml');
  assert.deepEqual(ci.jobs.compatibility.strategy.matrix.node, [22, 24]);
  assert.match(ci.jobs.compatibility.name, /contributor/u);
  for (const job of [ci.jobs['packed-public-packages'], workflow('release-proof.yml').jobs.proof]) {
    assert.deepEqual(job.strategy.matrix.node, [20, 22, 24]);
    const runtime = setups(job);
    assert.deepEqual(
      runtime.map(({ version }) => version),
      ['24', `\${{ matrix.node }}`],
    );
    const switchAt = runtime[1].index;
    const install = job.steps.findIndex((step) => step.run?.trim() === 'npm ci');
    const proof = job.steps.findIndex(
      (step) => step.run?.trim() === 'npm run verify:packed:strict',
    );
    assert.ok(install > runtime[0].index && install < switchAt);
    assert.ok(proof > switchAt);
    for (const [index, step] of job.steps.entries()) {
      if (/npm run (?:generate|build|test:focused|verify)(?:\s|$)/u.test(step.run ?? ''))
        assert.ok(index < switchAt, 'Contributor commands must precede the consumer runtime');
    }
  }
  const contributorChecks = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
    .scripts.verify.split(' && ')
    .filter((command) => command !== 'npm run verify:packed:strict');
  const release = workflow('release-proof.yml').jobs.proof;
  const preparation = release.steps
    .slice(0, setups(release)[1].index)
    .flatMap((step) => (step.run ?? '').split('\n').map((line) => line.trim()));
  for (const command of contributorChecks)
    assert.ok(preparation.includes(command), `Release proof retains ${command} before the switch`);
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
