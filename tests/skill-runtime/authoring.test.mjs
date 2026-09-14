import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { validateProtocolArtifact } from '../../packages/protocol/src/contracts.mjs';
import {
  checkSkill,
  compileComposedV1,
  evaluateSkill,
  generateSkill,
  lintSkill,
  loadComposedSkill,
  previewSkill,
} from '../../packages/skill-runtime/src/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const example = join(root, 'examples', 'skills', 'minimal-composed');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/gu, '\n');

function tempSkill() {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-authoring-'));
  const target = join(dir, 'skill');
  cpSync(example, target, { recursive: true });
  return target;
}

function addCodexAndCursorProfiles(skillDir) {
  const skillPath = join(skillDir, 'skill.json');
  const skill = JSON.parse(readFileSync(skillPath, 'utf8'));
  skill.hostProfiles.push(
    { id: 'minimal-codex', version: '1.0.0' },
    { id: 'minimal-cursor', version: '1.0.0' },
  );
  writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);

  const profilesPath = join(skillDir, 'host-profiles.json');
  const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
  const base = profiles.profiles[0];
  profiles.profiles.push(
    {
      ...base,
      hostProfileId: 'minimal-codex',
      host: 'codex',
      description: 'Codex profile for host-native authoring generation.',
    },
    {
      ...base,
      hostProfileId: 'minimal-cursor',
      host: 'cursor',
      description: 'Cursor profile for host-native authoring generation.',
    },
  );
  writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);
}

function walk(relativeRoot) {
  const absolute = join(root, relativeRoot);
  const files = [];
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

function snapshotTree(absoluteRoot) {
  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        files.push({
          path: path.slice(absoluteRoot.length + 1),
          bytes: readFileSync(path),
        });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function runNode(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => resolveRun({ status, signal, stdout, stderr }));
  });
}

function startLockContender({ skillDir, role, signalsDir, pauseBeforeClaim = false }) {
  const lockModule = new URL(
    '../../packages/skill-runtime/src/authoring/generation-lock.mjs',
    import.meta.url,
  ).href;
  const source = `
    import { existsSync, rmSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { acquireGenerationLock } from ${JSON.stringify(lockModule)};

    const [skillDir, role, signalsDir, pauseBeforeClaim] = process.argv.slice(1);
    const sleepState = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const sleep = (milliseconds) => Atomics.wait(sleepState, 0, 0, milliseconds);
    const pathFor = (name) => join(signalsDir, name);
    const signal = (name) => writeFileSync(pathFor(name), role + '\\n', { flag: 'wx' });
    const waitFor = (name) => {
      const deadline = Date.now() + 10_000;
      while (!existsSync(pathFor(name))) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + name);
        sleep(10);
      }
    };

    let paused = false;
    const release = acquireGenerationLock(skillDir, {
      beforeReclaimClaim: pauseBeforeClaim === 'true' ? () => {
        if (paused) return;
        paused = true;
        signal('first-observed-stale');
        waitFor('second-acquired');
        signal('first-resumed');
      } : undefined,
    });
    let entered = false;
    try {
      writeFileSync(pathFor('critical-section'), role + '\\n', { flag: 'wx' });
      entered = true;
      signal(role + '-acquired');
      waitFor(role + '-release');
    } finally {
      if (entered) rmSync(pathFor('critical-section'), { force: true });
      release();
    }
    signal(role + '-released');
  `;
  const child = spawn(process.execPath, [
    '--input-type=module',
    '--eval', source,
    skillDir,
    role,
    signalsDir,
    String(pauseBeforeClaim),
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completed = new Promise((resolveRun) => {
    child.on('close', (status, signal) => resolveRun({ status, signal, stdout, stderr }));
  });
  return { child, completed };
}

async function waitForPath(path, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function releaseContender(signalsDir, role) {
  const path = join(signalsDir, `${role}-release`);
  if (!existsSync(path)) writeFileSync(path, 'release\n');
}

test('the minimal composed-v1 example lints, previews, checks, and evaluates cleanly', () => {
  const lint = lintSkill({ skillDir: example });
  assert.equal(lint.ok, true);
  assert.equal(lint.exit, 0);
  assert.equal(lint.skillId, 'planr-hello');
  assert.deepEqual(lint.modules, [
    { moduleId: 'hello-intro', moduleVersion: '1.0.0', mode: 'inline' },
    { moduleId: 'hello-reference', moduleVersion: '1.0.0', mode: 'routed' },
  ]);
  assert.deepEqual(lint.hostProfiles, [{ id: 'minimal-claude-code', version: '1.0.0', host: 'claude-code' }]);

  const preview = previewSkill({ skillDir: example });
  assert.equal(preview.ok, true);
  const host = preview.hosts[0];
  assert.deepEqual(host.inline.map((module) => `${module.moduleId}@${module.moduleVersion}`), ['hello-intro@1.0.0']);
  assert.deepEqual(host.routed.map((reference) => reference.path), ['skills/planr-hello/references/hello-reference.md']);
  assert.equal(host.overlay.authority.repositoryAccess, 'read-only');
  assert.ok(host.owners.some((owner) => owner.ownerKind === 'template'));
  assert.ok(host.owners.some((owner) => owner.ownerKind === 'source'));
  assert.ok(host.owners.some((owner) => owner.ownerKind === 'compiler'));

  const check = checkSkill({ skillDir: example });
  assert.equal(check.ok, true);
  assert.equal(check.assets.length, 2);
  assert.deepEqual(check.output, { state: 'not-generated', checked: false, outputDir: 'dist' });

  const evaluate = evaluateSkill({ skillDir: example });
  assert.equal(evaluate.ok, true);
  assert.equal(evaluate.hosts[0].pass, true);
  assert.deepEqual(evaluate.hosts[0].checks, { idempotent: true, sourceMapComplete: true, manifestValid: true });
});

test('generate materializes one complete deterministic host output set', () => {
  const dir = tempSkill();
  try {
    const first = generateSkill({ skillDir: dir });
    assert.equal(first.ok, true);
    assert.equal(first.command, 'generate');
    assert.equal(first.outputDir, 'dist');
    assert.deepEqual(first.assets.map(({ outputPath }) => outputPath), [
      'claude-code/skills/planr-hello/SKILL.md',
      'claude-code/skills/planr-hello/references/hello-reference.md',
    ]);
    assert.deepEqual(first.manifests, [
      'manifests/generated-assets.json',
      'manifests/generated-custody.json',
    ]);

    const outputRoot = join(dir, 'dist');
    const loaded = loadComposedSkill({ skillDir: dir });
    const compiled = compileComposedV1({
      skillSource: loaded.skillSource,
      skillSourceCustody: loaded.skillSourceCustody,
      modules: loaded.modules,
      hostProfile: loaded.declaredProfiles[0],
      cursorTemplate: loaded.cursorTemplate,
      readSource: loaded.readSource,
    });
    assert.equal(
      readFileSync(join(outputRoot, 'claude-code', 'skills', 'planr-hello', 'SKILL.md'), 'utf8'),
      compiled.primary.bytes,
    );
    assert.equal(
      readFileSync(join(outputRoot, 'claude-code', 'skills', 'planr-hello', 'references', 'hello-reference.md'), 'utf8'),
      compiled.references[0].bytes,
    );

    const manifest = JSON.parse(readFileSync(join(outputRoot, 'manifests', 'generated-assets.json'), 'utf8'));
    const custody = JSON.parse(readFileSync(join(outputRoot, 'manifests', 'generated-custody.json'), 'utf8'));
    assert.deepEqual(validateProtocolArtifact('generated-asset-manifest', manifest, { protocolVersion: '1.6.0' }), []);
    assert.equal(custody.assetSetId, manifest.assetSetId);
    assert.equal(custody.assets.length, manifest.assets.length);

    const before = snapshotTree(outputRoot);
    const second = generateSkill({ skillDir: dir });
    assert.equal(second.ok, true);
    assert.equal(second.assetSetId, first.assetSetId);
    assert.deepEqual(snapshotTree(outputRoot), before);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test('check reports generated-output drift without mutating the output tree', () => {
  const dir = tempSkill();
  try {
    assert.equal(generateSkill({ skillDir: dir }).ok, true);
    const current = checkSkill({ skillDir: dir });
    assert.equal(current.ok, true);
    assert.deepEqual(current.output, { state: 'current', checked: true, outputDir: 'dist' });

    const target = join(dir, 'dist', 'claude-code', 'skills', 'planr-hello', 'SKILL.md');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\nhand edited\n`);
    const before = readFileSync(target, 'utf8');
    const drifted = checkSkill({ skillDir: dir });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.diagnostics[0].code, 'E_SKILL_GENERATED_OUTPUT_DRIFT');
    assert.equal(drifted.diagnostics[0].path, 'dist/claude-code/skills/planr-hello/SKILL.md');
    assert.match(drifted.diagnostics[0].repair, /generator/u);
    assert.equal(readFileSync(target, 'utf8'), before);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test('generate materializes exact Codex and Cursor host-native shapes and paths', () => {
  const dir = tempSkill();
  try {
    addCodexAndCursorProfiles(dir);
    const result = generateSkill({ skillDir: dir });
    assert.equal(result.ok, true);
    assert.deepEqual(result.assets.map(({ outputPath }) => outputPath), [
      'claude-code/skills/planr-hello/SKILL.md',
      'claude-code/skills/planr-hello/references/hello-reference.md',
      'codex/skills/planr-hello/SKILL.md',
      'codex/skills/planr-hello/references/hello-reference.md',
      'cursor/rules/planr-hello.mdc',
      'cursor/rules/references/planr-hello/hello-reference.md',
    ]);

    const codex = readFileSync(join(dir, 'dist', 'codex', 'skills', 'planr-hello', 'SKILL.md'), 'utf8');
    assert.ok(codex.startsWith(
      '---\nname: planr-hello\ndescription: Minimal composed-v1 example skill.\n---\n\n',
    ));
    assert.doesNotMatch(codex, /^allowed-tools:/mu);

    const cursor = readFileSync(join(dir, 'dist', 'cursor', 'rules', 'planr-hello.mdc'), 'utf8');
    assert.ok(cursor.startsWith(
      '---\ndescription: "Minimal composed-v1 example skill."\nalwaysApply: false\n---\n\n',
    ));
    assert.doesNotMatch(cursor, /^(?:name|allowed-tools):/mu);

    const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'manifests', 'generated-assets.json'), 'utf8'));
    assert.deepEqual(validateProtocolArtifact('generated-asset-manifest', manifest, { protocolVersion: '1.6.0' }), []);
    assert.deepEqual(
      manifest.assets.map(({ host, path }) => `${host}:${path}`).sort(),
      result.assets.map(({ host, path }) => `${host}:${path}`).sort(),
    );
    const regenerated = generateSkill({ skillDir: dir });
    assert.equal(regenerated.ok, true);
    assert.equal(regenerated.assetSetId, result.assetSetId);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test('generate validates completely before replacing a prior output set', () => {
  const dir = tempSkill();
  try {
    assert.equal(generateSkill({ skillDir: dir }).ok, true);
    const outputRoot = join(dir, 'dist');
    const before = snapshotTree(outputRoot);
    const templatePath = join(dir, 'SKILL.md.tmpl');
    writeFileSync(templatePath, readFileSync(templatePath, 'utf8').replace('{{MODULES}}', '{{UNKNOWN}}\n\n{{MODULES}}'));

    const failed = generateSkill({ skillDir: dir });
    assert.equal(failed.ok, false);
    assert.equal(failed.diagnostics[0].code, 'E_TEMPLATE_TOKEN_UNRESOLVED');
    assert.deepEqual(snapshotTree(outputRoot), before);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test('generate never overwrites an unrelated or symlinked dist path', () => {
  const unowned = tempSkill();
  const symlinked = tempSkill();
  const external = mkdtempSync(join(tmpdir(), 'openplanr-authoring-external-'));
  try {
    mkdirSync(join(unowned, 'dist'));
    writeFileSync(join(unowned, 'dist', 'keep.txt'), 'user-owned\n');
    const unownedResult = generateSkill({ skillDir: unowned });
    assert.equal(unownedResult.ok, false);
    assert.equal(unownedResult.diagnostics[0].code, 'E_SKILL_OUTPUT_UNOWNED');
    assert.equal(readFileSync(join(unowned, 'dist', 'keep.txt'), 'utf8'), 'user-owned\n');

    symlinkSync(external, join(symlinked, 'dist'));
    const symlinkResult = generateSkill({ skillDir: symlinked });
    assert.equal(symlinkResult.ok, false);
    assert.equal(symlinkResult.diagnostics[0].code, 'E_SKILL_OUTPUT_UNOWNED');
  } finally {
    rmSync(dirname(unowned), { recursive: true, force: true });
    rmSync(dirname(symlinked), { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test('concurrent composed generations serialize and converge on one complete output', async () => {
  const dir = tempSkill();
  const script = join(root, 'scripts', 'skills', 'generate-composed.mjs');
  try {
    const runs = await Promise.all(Array.from(
      { length: 8 },
      () => runNode([script, dir, '--json']),
    ));
    for (const run of runs) {
      assert.equal(run.status, 0, `${run.signal ?? ''} ${run.stderr}`);
      assert.equal(JSON.parse(run.stdout).ok, true);
    }
    const outputRoot = join(dir, 'dist');
    assert.deepEqual(snapshotTree(outputRoot).map(({ path }) => path), [
      'claude-code/skills/planr-hello/references/hello-reference.md',
      'claude-code/skills/planr-hello/SKILL.md',
      'manifests/generated-assets.json',
      'manifests/generated-custody.json',
    ]);
    assert.equal(existsSync(join(dir, '.openplanr-generate.lock')), false);
    assert.equal(readdirSync(dir).some((name) => name.startsWith('.openplanr-dist-') || name.startsWith('.openplanr-backup-')), false);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test('generation reclaims an aged ownerless or corrupt legacy lock', () => {
  for (const ownerBytes of [null, '{not-json\n']) {
    const dir = tempSkill();
    try {
      const lockPath = join(dir, '.openplanr-generate.lock');
      mkdirSync(lockPath);
      if (ownerBytes !== null) writeFileSync(join(lockPath, 'owner.json'), ownerBytes);
      const stale = new Date(Date.now() - 60_000);
      utimesSync(lockPath, stale, stale);

      const result = generateSkill({ skillDir: dir });
      assert.equal(result.ok, true);
      assert.equal(existsSync(lockPath), false);
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }
});

test('generation recovers dead or malformed stale-reclaim claimants', () => {
  for (const claimant of ['dead', 'malformed']) {
    const dir = tempSkill();
    try {
      const lockPath = join(dir, '.openplanr-generate.lock');
      const claimPath = join(lockPath, '.openplanr-generate-reclaim');
      mkdirSync(lockPath);
      mkdirSync(claimPath);
      const lockStat = statSync(lockPath);
      if (claimant === 'dead') {
        const deadPid = spawnSync(process.execPath, ['--eval', '']).pid;
        writeFileSync(join(claimPath, 'owner.json'), `${JSON.stringify({
          pid: deadPid,
          token: 'dead-reclaimer',
          lockIdentity: `${lockStat.dev}:${lockStat.ino}`,
        })}\n`);
      } else {
        writeFileSync(join(claimPath, 'owner.json'), '{not-json\n');
        const staleClaim = new Date(Date.now() - 60_000);
        utimesSync(claimPath, staleClaim, staleClaim);
      }
      const staleLock = new Date(Date.now() - 60_000);
      utimesSync(lockPath, staleLock, staleLock);

      const result = generateSkill({ skillDir: dir });
      assert.equal(result.ok, true, claimant);
      assert.equal(existsSync(lockPath), false, claimant);
      assert.equal(
        readdirSync(dir).some((name) => name.startsWith('.openplanr-generate-reclaimed-')),
        false,
        claimant,
      );
    } finally {
      rmSync(dirname(dir), { recursive: true, force: true });
    }
  }
});

test('competing stale reclaimers never evict a freshly acquired fixed lock', { timeout: 15_000 }, async () => {
  const dir = tempSkill();
  const signalsDir = mkdtempSync(join(tmpdir(), 'openplanr-lock-race-'));
  const contenders = [];
  try {
    const lockPath = join(dir, '.openplanr-generate.lock');
    mkdirSync(lockPath);
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockPath, stale, stale);

    const first = startLockContender({
      skillDir: dir,
      role: 'first',
      signalsDir,
      pauseBeforeClaim: true,
    });
    contenders.push(first);
    await waitForPath(join(signalsDir, 'first-observed-stale'));

    const second = startLockContender({ skillDir: dir, role: 'second', signalsDir });
    contenders.push(second);
    await waitForPath(join(signalsDir, 'second-acquired'));
    await waitForPath(join(signalsDir, 'first-resumed'));

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.equal(existsSync(join(signalsDir, 'first-acquired')), false);
    assert.equal(readFileSync(join(signalsDir, 'critical-section'), 'utf8'), 'second\n');

    releaseContender(signalsDir, 'second');
    await waitForPath(join(signalsDir, 'second-released'));
    await waitForPath(join(signalsDir, 'first-acquired'));
    assert.equal(readFileSync(join(signalsDir, 'critical-section'), 'utf8'), 'first\n');
    releaseContender(signalsDir, 'first');
    await waitForPath(join(signalsDir, 'first-released'));

    const runs = await Promise.all(contenders.map(({ completed }) => completed));
    for (const run of runs) {
      assert.equal(run.status, 0, `${run.signal ?? ''} ${run.stderr}`);
      assert.doesNotMatch(run.stderr, /E_SKILL_GENERATION_LOCK_LOST/u);
    }
    assert.equal(existsSync(lockPath), false);
  } finally {
    releaseContender(signalsDir, 'second');
    releaseContender(signalsDir, 'first');
    for (const { child } of contenders) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await Promise.allSettled(contenders.map(({ completed }) => completed));
    rmSync(dirname(dir), { recursive: true, force: true });
    rmSync(signalsDir, { recursive: true, force: true });
  }
});

test('the composed generate CLI has stable human, JSON, and usage contracts', () => {
  const dir = tempSkill();
  const script = join(root, 'scripts', 'skills', 'generate-composed.mjs');
  try {
    const human = execFileSync(process.execPath, [script, dir], { cwd: root, encoding: 'utf8' });
    assert.match(human, /^generate ok: planr-hello@1\.0\.0 -> dist\//u);
    assert.match(human, /wrote claude-code\/skills\/planr-hello\/SKILL\.md/u);
    assert.doesNotMatch(human, /sha256:/u);

    const json = JSON.parse(execFileSync(process.execPath, [script, dir, '--json'], { cwd: root, encoding: 'utf8' }));
    assert.equal(json.ok, true);
    assert.equal(json.command, 'generate');
    assert.equal(json.assets.length, 2);

    const usage = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Exactly one skill directory argument is required/u);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
});

test('the legacy composed preview names the exact compiler-owned emitted ranges', () => {
  const output = execFileSync(process.execPath, [
    join(root, 'scripts', 'skills', 'preview.mjs'),
    example,
  ], { cwd: root, encoding: 'utf8' });
  const ownerLines = output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('owner '));
  assert.deepEqual(ownerLines, [
    'owner template SKILL.md.tmpl@1.0.0',
    'owner source skill.json#/skillId@1.0.0',
    'owner source modules/hello-intro.md@1.0.0',
    'owner compiler packages/skill-runtime/src/compiler/render-primitives.mjs#/HOST_SUBSTITUTIONS/claude-code@1.0.0',
  ]);
  assert.doesNotMatch(output, /owner host-profile /u);
});

test('authoring operations are mutation-free', () => {
  const before = walk('examples/skills/minimal-composed').map((path) => ({ path, size: statSync(path).size, digest: createHash('sha256').update(readFileSync(path)).digest('hex') }));
  lintSkill({ skillDir: example });
  previewSkill({ skillDir: example });
  checkSkill({ skillDir: example });
  evaluateSkill({ skillDir: example });
  const after = walk('examples/skills/minimal-composed').map((path) => ({ path, size: statSync(path).size, digest: createHash('sha256').update(readFileSync(path)).digest('hex') }));
  assert.deepEqual(after, before);
});

test('a typed failure envelope names code, pointer, and repair without mutating the skill', () => {
  const dir = tempSkill();
  try {
    const skillPath = join(dir, 'skill.json');
    const skill = JSON.parse(readFileSync(skillPath, 'utf8'));
    skill.modules[0].moduleVersion = '9.9.9';
    writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);
    const beforeModule = readFileSync(join(dir, 'modules.json'), 'utf8');

    const result = lintSkill({ skillDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.exit, 1);
    const diagnostic = result.diagnostics[0];
    assert.match(diagnostic.code, /^E_SKILL_/u);
    assert.ok(diagnostic.pointer);
    assert.ok(diagnostic.repair);
    // Check runs the same graph in memory and never rewrites the source graph.
    checkSkill({ skillDir: dir });
    assert.equal(readFileSync(join(dir, 'modules.json'), 'utf8'), beforeModule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unresolved template token fails check with a typed, owning diagnostic', () => {
  const dir = tempSkill();
  try {
    const templatePath = join(dir, 'SKILL.md.tmpl');
    writeFileSync(templatePath, `${readFileSync(templatePath, 'utf8').replace('{{MODULES}}', '{{UNRESOLVED}}\n\n{{MODULES}}')}`);
    const result = checkSkill({ skillDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.exit, 1);
    assert.equal(result.diagnostics[0].code, 'E_TEMPLATE_TOKEN_UNRESOLVED');
    assert.ok(result.diagnostics[0].repair);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime entry points resolve and every export is covered by a checked declaration', async () => {
  const subpaths = [
    ['src/index.mjs', 'src/index.d.mts'],
    ['src/authoring/index.mjs', 'src/authoring/index.d.mts'],
    ['src/compiler/index.mjs', 'src/compiler/index.d.mts'],
    ['src/lifecycle/index.mjs', 'src/lifecycle/index.d.mts'],
    ['src/manifests/index.mjs', 'src/manifests/index.d.mts'],
    ['src/matching/index.mjs', 'src/matching/index.d.mts'],
    ['src/resolver/index.mjs', 'src/resolver/index.d.mts'],
    ['src/versioning/index.mjs', 'src/versioning/index.d.mts'],
  ];
  for (const [modulePath, declarationPath] of subpaths) {
    const namespace = await import(`../../packages/skill-runtime/${modulePath}`);
    const runtimeExports = Object.keys(namespace).filter((name) => name !== 'default').sort();
    const declaration = read(`packages/skill-runtime/${declarationPath}`);
    const declared = new Set();
    for (const match of declaration.matchAll(/export\s+declare\s+(?:function|class|const)\s+([A-Za-z0-9_]+)/gu)) declared.add(match[1]);
    for (const block of declaration.matchAll(/export\s*\{([^}]*)\}\s*from/gu)) {
      for (const name of block[1].split(',')) {
        const trimmed = name.trim();
        if (trimmed) declared.add(trimmed);
      }
    }
    for (const name of runtimeExports) {
      assert.ok(declared.has(name), `${declarationPath} is missing a declaration for ${name}`);
    }
    assert.ok(declaration.trim().length > 0, `${declarationPath} must be a non-empty declaration file`);
  }
});

test('compiler and manifest declarations accept compiler ownership and preserve readonly results', () => {
  execFileSync(process.execPath, [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target', 'ES2022',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    join(root, 'tests', 'skill-runtime', 'fixtures', 'declaration-contract.mts'),
  ], { cwd: root, encoding: 'utf8' });
});

test('package.json wires every typed skill-runtime export subpath', () => {
  const manifest = JSON.parse(read('packages/skill-runtime/package.json'));
  for (const subpath of ['.', './authoring', './compiler', './lifecycle', './manifests', './matching', './resolver', './versioning']) {
    const entry = manifest.exports[subpath];
    assert.equal(typeof entry, 'object', subpath);
    assert.match(entry.types, /\.d\.mts$/u, subpath);
    assert.ok(entry.import.endsWith('.mjs'), subpath);
  }
  const workspace = JSON.parse(read('package.json'));
  assert.equal(workspace.scripts['skill:generate'], 'node scripts/skills/generate-v18.mjs --write');
  assert.equal(manifest.scripts.generate, 'node ../../scripts/skills/generate-v18.mjs --write');
});

test('prompt purity scan: no generated skill or composed asset embeds deterministic algorithm prose', () => {
  const algorithmSignatures = [
    /createHash\s*\(/u,
    /crypto\./u,
    /sha256\s*\(/u,
    /\.digest\s*\(/u,
    /=>\s*\{/u,
    /\bfunction\s*\(/u,
    /\bfor\s*\(const\s/u,
    /\bwhile\s*\(/u,
    /\.map\s*\(/u,
    /\.filter\s*\(/u,
  ];
  const roots = [
    'dist/plugins/claude/openplanr/skills',
    'dist/plugins/openai/openplanr/skills',
    'dist/plugins/cursor/openplanr/rules',
  ];
  const generated = roots.flatMap((relativeRoot) => walk(relativeRoot))
    .filter((path) => path.endsWith('SKILL.md') || path.endsWith('.mdc'));
  assert.ok(generated.length >= 23);

  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const composed = compileComposedV1({ skillSource, skillSourceCustody, modules, hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'), readSource });
  const subjects = [...generated.map((path) => readFileSync(path, 'utf8')), composed.primary.bytes, ...composed.references.map((reference) => reference.bytes)];

  for (const bytes of subjects) {
    for (const signature of algorithmSignatures) {
      assert.doesNotMatch(bytes, signature, `generated prose embeds ${signature}`);
    }
  }
});

test('composed asset and diagnostic results carry no maintainer integrity or workflow bookkeeping', () => {
  const opaqueTerms = [
    /\breceipt\b/iu,
    /\brun[- ]?id\b/iu,
    /\bowner(?:'s)?\s+phrase\b/iu,
    /\bgeneration counter\b/iu,
    /\bevent file\b/iu,
    /\breviewer roster\b/iu,
    /sha256:/u,
  ];
  const { skillSource, skillSourceCustody, modules, hostProfilesByKey, readSource } = loadComposedSkill({ skillDir: example });
  const composed = compileComposedV1({ skillSource, skillSourceCustody, modules, hostProfile: hostProfilesByKey.get('minimal-claude-code@1.0.0'), readSource });
  for (const term of opaqueTerms) {
    assert.doesNotMatch(composed.primary.bytes, term, `composed skill body exposes ${term}`);
  }
  // Human evaluate output never surfaces a hash or workflow record.
  const evaluate = evaluateSkill({ skillDir: example });
  const serialized = JSON.stringify(evaluate);
  for (const term of [/\breceipt\b/iu, /\brun[- ]?id\b/iu, /\bowner(?:'s)?\s+phrase\b/iu]) {
    assert.doesNotMatch(serialized, term);
  }
});

test('the optional completion-record contract is not an active workflow dependency', () => {
  const activeFiles = [
    ...walk('skills'),
    ...walk('packages/skill-runtime/src'),
    ...walk('packages/cli/src'),
    ...walk('packages/pipeline/lib').filter((path) => (
      !path.includes('/lib/protocol/') && !path.includes('/lib/generated/')
    )),
  ];

  for (const path of activeFiles) {
    assert.doesNotMatch(
      readFileSync(path, 'utf8'),
      /skill-completion-receipt/u,
      `${path} must not activate the compatibility-only completion record`,
    );
  }
});

test('host profiles retain distinct exact versions and declared versions resolve without overwrite ambiguity', () => {
  const dir = tempSkill();
  try {
    const profilesPath = join(dir, 'host-profiles.json');
    const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
    profiles.profiles.push({
      ...profiles.profiles[0],
      hostProfileVersion: '2.0.0',
      description: 'Second exact version of the same host profile.',
    });
    writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);

    const loaded = loadComposedSkill({ skillDir: dir });
    assert.deepEqual([...loaded.hostProfilesByKey.keys()], [
      'minimal-claude-code@1.0.0',
      'minimal-claude-code@2.0.0',
    ]);
    assert.equal(loaded.hostProfileRegistry.schemaVersion, '1.0.0');
    assert.equal(loaded.hostProfileRegistry.documentVersion, '1.0.0');
    assert.equal(loaded.hostProfileRegistry.profiles.length, 2);
    assert.equal(loaded.declaredProfiles[0].hostProfileVersion, '1.0.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authoring preserves optional host capability and interaction bindings', () => {
  const dir = tempSkill();
  try {
    const profilesPath = join(dir, 'host-profiles.json');
    const document = JSON.parse(readFileSync(profilesPath, 'utf8'));
    document.profiles[0].runtimeCapabilities = ['native-questions', 'structured-chat'];
    document.profiles[0].interactionBindings = [
      { surface: 'native', protocolInteraction: 'native', capabilityId: 'native-questions' },
      { surface: 'chat', protocolInteraction: 'chat', capabilityId: 'structured-chat' },
      { surface: 'headless', protocolInteraction: 'none' },
    ];
    writeFileSync(profilesPath, `${JSON.stringify(document, null, 2)}\n`);

    const loaded = loadComposedSkill({ skillDir: dir });
    const profileValue = loaded.hostProfilesByKey.get('minimal-claude-code@1.0.0');
    assert.equal(loaded.hostProfileRegistry.schemaVersion, '1.1.0');
    assert.equal(loaded.hostProfileRegistry.documentVersion, '1.1.0');
    assert.deepEqual(profileValue.runtimeCapabilities, ['native-questions', 'structured-chat']);
    assert.deepEqual(profileValue.interactionBindings.map(({ surface }) => surface), ['native', 'chat', 'headless']);
    assert.deepEqual(
      validateProtocolArtifact('skill-host-profile-registry', loaded.hostProfileRegistry, { protocolVersion: '1.6.0' }),
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate exact host-profile keys fail with a typed authoring diagnostic', () => {
  const dir = tempSkill();
  try {
    const profilesPath = join(dir, 'host-profiles.json');
    const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
    profiles.profiles.push({ ...profiles.profiles[0] });
    writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);

    const result = lintSkill({ skillDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'E_SKILL_HOST_PROFILE_DUPLICATE');
    assert.equal(result.diagnostics[0].pointer, 'host-profiles.json#/minimal-claude-code@1.0.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schema diagnostics expose the Protocol path and detail to the author', () => {
  const dir = tempSkill();
  try {
    const skillPath = join(dir, 'skill.json');
    const skill = JSON.parse(readFileSync(skillPath, 'utf8'));
    skill.authorityCeiling.allowedTools = ['invented-tool'];
    writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);

    const result = lintSkill({ skillDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'E_SKILL_SOURCE_SCHEMA_INVALID');
    assert.equal(result.diagnostics[0].pointer, '$.authorityCeiling.allowedTools[0]');
    assert.match(result.diagnostics[0].message, /does not match|enum|expected/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
