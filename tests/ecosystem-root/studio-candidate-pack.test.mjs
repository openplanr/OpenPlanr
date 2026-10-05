import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'studio-public-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts/release-train'), { recursive: true });
  await copyFile(
    resolve('scripts/release-train/pack-studio-candidate.mjs'),
    join(root, 'scripts/release-train/pack-studio-candidate.mjs'),
  );
  for (const [scope, name, version] of [
    ['protocol', '@openplanr/protocol', '0.8.0'],
    ['pipeline', '@openplanr/pipeline', '0.55.7'],
  ]) {
    const directory = join(root, 'packages', scope);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name, version, files: ['index.mjs', 'lib/'] }),
    );
    await writeFile(join(directory, 'index.mjs'), 'export const candidate = true;\n');
  }
  await writeFile(
    join(root, '.gitignore'),
    [
      'node_modules/',
      '/cache/',
      '/packed/',
      '/wrong-commit/',
      '/dirty/',
      '/packages/pipeline/lib/generated.mjs',
      '/packages/pipeline/lib/built.mjs',
      '/packages/pipeline/lib/arbitrary.mjs',
    ].join('\n') + '\n',
  );
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'studio-candidate-fixture',
      private: true,
      type: 'module',
      workspaces: ['packages/protocol', 'packages/pipeline'],
      scripts: {
        generate: 'node scripts/generate-fixture.mjs',
        build: 'node scripts/build-fixture.mjs',
      },
    }),
  );
  await writeFile(
    join(root, 'scripts/generate-fixture.mjs'),
    `import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','OPENPLANR_ECOSYSTEM_SOURCE','OPENPLANR_PIPELINE_ROOT','OPENPLANR_PIPELINE_TARBALL','OPENPLANR_VERIFIER_SOURCE_ROOT','PLANR_PIPELINE_ROOT','PLANR_PIPELINE_VERIFIER_SOURCE_ROOT']) assert.equal(process.env[key],undefined,key);
mkdirSync('packages/pipeline/lib',{recursive:true});
writeFileSync('packages/pipeline/lib/generated.mjs','export const committedGenerated = true;\\n');
`,
  );
  await writeFile(
    join(root, 'scripts/build-fixture.mjs'),
    `import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
assert.equal(readFileSync('packages/pipeline/lib/generated.mjs','utf8'),'export const committedGenerated = true;\\n');
writeFileSync('packages/pipeline/lib/built.mjs','export const committedBuild = true;\\n');
`,
  );
  const env = {
    ...process.env,
    npm_config_cache: join(root, 'cache'),
    npm_config_offline: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
  delete env.GITHUB_SHA;
  execFileSync(
    process.env.npm_execpath ? process.execPath : 'npm',
    [
      ...(process.env.npm_execpath ? [process.env.npm_execpath] : []),
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--offline',
    ],
    { cwd: root, env, stdio: 'pipe' },
  );
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('add', '.');
  git(
    '-c',
    'user.name=Studio fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'test: create package fixture',
  );
  return { root, git, env, script: join(root, 'scripts/release-train/pack-studio-candidate.mjs') };
}

test('Studio CI archives bind the exact committed source and archive bytes', async (t) => {
  const { root, git, env, script } = await fixture(t);
  const output = join(root, 'packed');
  execFileSync(process.execPath, [script, output], { env, stdio: 'pipe' });
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, 'openplanr-studio-public-candidate');
  assert.equal(manifest.repository, 'openplanr/OpenPlanr');
  assert.equal(manifest.commit, git('rev-parse', 'HEAD'));
  assert.deepEqual(
    manifest.packages.map(({ name }) => name),
    ['@openplanr/protocol', '@openplanr/pipeline'],
  );
  for (const archive of manifest.packages) {
    const bytes = await readFile(join(output, archive.file));
    assert.equal(bytes.length, archive.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), archive.sha256);
    const contents = JSON.parse(
      execFileSync('tar', ['-xOf', join(output, archive.file), 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
    assert.equal(contents.name, archive.name);
    assert.equal(contents.version, archive.version);
  }
  assert.throws(
    () => execFileSync(process.execPath, [script, output], { env, stdio: 'pipe' }),
    /output directory must be empty/,
  );
});

test('Studio CI refuses changed source and a different requested commit', async (t) => {
  const { root, env, script } = await fixture(t);
  assert.throws(
    () =>
      execFileSync(process.execPath, [script, join(root, 'wrong-commit')], {
        env: { ...env, GITHUB_SHA: '0'.repeat(40) },
        stdio: 'pipe',
      }),
    /checkout does not match/,
  );
  await writeFile(join(root, 'packages/protocol/index.mjs'), 'export const candidate = false;\n');
  assert.throws(
    () => execFileSync(process.execPath, [script, join(root, 'dirty')], { env, stdio: 'pipe' }),
    /Commit the reviewed public source/,
  );
});

async function pipelineArchive(root) {
  const manifest = JSON.parse(await readFile(join(root, 'packed/manifest.json'), 'utf8'));
  return join(
    root,
    'packed',
    manifest.packages.find(({ name }) => name === '@openplanr/pipeline').file,
  );
}
test('an ambient ignored arbitrary module cannot enter the archive claiming HEAD', async (t) => {
  const { root, git, env, script } = await fixture(t);
  await mkdir(join(root, 'packages/pipeline/lib'), { recursive: true });
  await writeFile(
    join(root, 'packages/pipeline/lib/arbitrary.mjs'),
    'export const unreviewed = true;\n',
  );
  assert.equal(git('status', '--porcelain'), '');
  execFileSync(process.execPath, [script, join(root, 'packed')], { env, stdio: 'pipe' });
  const archive = await pipelineArchive(root);
  const members = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.doesNotMatch(members, /arbitrary\.mjs/u);
  assert.match(members, /package\/lib\/generated\.mjs/u);
  assert.equal(
    await readFile(join(root, 'packages/pipeline/lib/arbitrary.mjs'), 'utf8'),
    'export const unreviewed = true;\n',
  );
  assert.equal(git('status', '--porcelain'), '');
});
test('modified ignored declared-generated bytes are rebuilt from the committed prerequisites', async (t) => {
  const { root, git, env, script } = await fixture(t);
  await mkdir(join(root, 'packages/pipeline/lib'), { recursive: true });
  const file = join(root, 'packages/pipeline/lib/generated.mjs');
  const injected = 'export const unreviewedGenerated = true;\n';
  await writeFile(file, injected);
  assert.equal(git('status', '--porcelain'), '');
  execFileSync(process.execPath, [script, join(root, 'packed')], { env, stdio: 'pipe' });
  const archive = await pipelineArchive(root);
  assert.equal(
    execFileSync('tar', ['-xOf', archive, 'package/lib/generated.mjs'], { encoding: 'utf8' }),
    'export const committedGenerated = true;\n',
  );
  assert.equal(
    execFileSync('tar', ['-xOf', archive, 'package/lib/built.mjs'], { encoding: 'utf8' }),
    'export const committedBuild = true;\n',
  );
  assert.equal(await readFile(file, 'utf8'), injected, 'ambient generated bytes remain untouched');
  assert.equal(git('status', '--porcelain'), '');
});
test('missing committed generation prerequisites fail closed rather than reusing ambient outputs', async (t) => {
  const { root, git, env, script } = await fixture(t);
  const file = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  delete manifest.scripts.generate;
  await writeFile(file, JSON.stringify(manifest));
  git('add', 'package.json');
  git(
    '-c',
    'user.name=Studio fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'test: missing generation prerequisite',
  );
  assert.throws(
    () => execFileSync(process.execPath, [script, join(root, 'packed')], { env, stdio: 'pipe' }),
    /must declare its generation and build prerequisites/u,
  );
  await assert.rejects(readFile(join(root, 'packed/manifest.json')), { code: 'ENOENT' });
});

test('conflicting Git custody and source fallback environment cannot redirect the candidate', async (t) => {
  const canonical = await fixture(t);
  const other = await fixture(t);
  await writeFile(
    join(other.root, 'packages/protocol/index.mjs'),
    'export const unrelated = true;\n',
  );
  other.git('add', 'packages/protocol/index.mjs');
  other.git(
    '-c',
    'user.name=Studio fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'test: unrelated source',
  );
  const canonicalCommit = canonical.git('rev-parse', 'HEAD');
  assert.notEqual(canonicalCommit, other.git('rev-parse', 'HEAD'));
  const conflicting = {
    ...canonical.env,
    GIT_DIR: join(other.root, '.git'),
    GIT_WORK_TREE: other.root,
    GIT_INDEX_FILE: join(other.root, '.git/index'),
    GIT_COMMON_DIR: join(other.root, '.git'),
    OPENPLANR_ECOSYSTEM_SOURCE: other.root,
    OPENPLANR_PIPELINE_ROOT: other.root,
    OPENPLANR_PIPELINE_TARBALL: other.root,
    OPENPLANR_VERIFIER_SOURCE_ROOT: other.root,
    PLANR_PIPELINE_ROOT: other.root,
    PLANR_PIPELINE_VERIFIER_SOURCE_ROOT: other.root,
    NPM_CONFIG_PREFIX: other.root,
    npm_config_workspace: 'unrelated-workspace',
  };
  execFileSync(process.execPath, [canonical.script, join(canonical.root, 'packed')], {
    env: conflicting,
    stdio: 'pipe',
  });
  const receipt = JSON.parse(await readFile(join(canonical.root, 'packed/manifest.json'), 'utf8'));
  assert.equal(receipt.commit, canonicalCommit);
  const protocol = receipt.packages.find(({ name }) => name === '@openplanr/protocol');
  assert.equal(
    execFileSync(
      'tar',
      ['-xOf', join(canonical.root, 'packed', protocol.file), 'package/index.mjs'],
      { encoding: 'utf8' },
    ),
    'export const candidate = true;\n',
  );
  assert.equal(canonical.git('status', '--porcelain'), '');
  assert.equal(other.git('status', '--porcelain'), '');
});
