import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCredentialFreeText,
  buildContextCapsule,
  previewContextCapsule,
  resolvePlanningArtifact,
  validateContextMirror,
  writeContextCapsule,
} from '../../skills/planr-delegate/scripts/context.mjs';

const specDir = '.planr/specs/SPEC-016-delegate';
const taskPath = `${specDir}/tasks/T-068-context.md`;
const storyPath = `${specDir}/stories/US-059-context.md`;
const specPath = `${specDir}/SPEC-016-delegate.md`;
const gherkinPath = `${specDir}/stories/US-059-gherkin.feature`;

async function put(root, path, content) {
  const destination = join(root, path);
  await mkdir(join(destination, '..'), { recursive: true });
  await writeFile(destination, content);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'planr-capsule-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(
    root,
    taskPath,
    '---\nid: "T-068"\ntitle: "Keep complete context"\nstoryId: "US-059"\nspecId: "SPEC-016"\ndependsOn: [\'T-067\']\n---\n# Task\nKeep the complete task text.\n',
  );
  await put(
    root,
    `${specDir}/tasks/T-067-dependency.md`,
    '---\nid: "T-067"\nproducedInterfaces: ["src/adapter.mjs"]\n---\n# Produced interface\nUse adapter v1.\n',
  );
  await put(
    root,
    storyPath,
    '---\nid: "US-059"\nspecId: "SPEC-016"\n---\n# Acceptance\nRead US-059-gherkin.feature.\n',
  );
  await put(root, gherkinPath, 'Feature: Context\r\n  Scenario: Complete copies\r\n');
  await put(
    root,
    specPath,
    '---\nid: "SPEC-016"\ntech_dependencies:\n  - ".planr/adrs/ADR-001-scope.md"\n---\n# Specification\nHonor ADR-001.\n',
  );
  await put(root, '.planr/adrs/ADR-001-scope.md', '---\nid: "ADR-001"\n---\n# Decision\n');
  await put(root, 'AGENTS.md', '# Repository instructions\n');
  await put(root, 'src/AGENTS.md', '# Source instructions\n');
  await put(root, 'src/adapter.mjs', 'export const adapterVersion = 1;\n');
  await put(root, 'src/code.bin', Buffer.from([0, 255, 13, 10, 65]));
  return root;
}

function copied(capsule, path, repositoryKey = 'project') {
  return capsule.files.find((file) => file.path === path && file.repositoryKey === repositoryKey);
}

async function rejectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.ok(!JSON.stringify(error).includes('super-secret-value'));
    return true;
  });
}

test('exact task capsule copies ignored planning and binary source bytes with parent links', async (t) => {
  const root = await fixture(t);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    taskSelector: 'T-068',
    selectedFiles: ['src/code.bin'],
  });
  assert.equal(capsule.mode, 'task');
  assert.equal(capsule.selector, 'T-068');
  assert.deepEqual(
    capsule.files.slice(0, 3).map((file) => file.path),
    [taskPath, storyPath, specPath],
  );
  for (const path of [
    taskPath,
    storyPath,
    specPath,
    gherkinPath,
    `${specDir}/tasks/T-067-dependency.md`,
    'src/adapter.mjs',
    '.planr/adrs/ADR-001-scope.md',
    'AGENTS.md',
    'src/AGENTS.md',
    'src/code.bin',
  ]) {
    const file = copied(capsule, path);
    assert.ok(file, `missing ${path}`);
    assert.deepEqual(Buffer.from(file.contentBase64, 'base64'), await readFile(join(root, path)));
  }
  assert.match(capsule.brief, /complete copied task/u);
  assert.equal(capsule.inventory.length, capsule.files.length);
  assert.ok(capsule.inventory.every((file) => !('contentBase64' in file)));
  assert.ok(previewContextCapsule(capsule).inventory.some((file) => file.path === taskPath));
});

test('exact, absent, and ambiguous selectors never guess across layouts', async (t) => {
  const root = await fixture(t);
  await put(root, '.planr/tasks/T-068-legacy.md', '---\nid: "T-068"\n---\n');
  await put(root, '.planr/quick/QT-001-quick.md', '---\nid: "QT-001"\n---\n');
  await rejectCode(resolvePlanningArtifact(root, 'T-068'), 'E_CAPSULE_AMBIGUOUS');
  await assert.rejects(resolvePlanningArtifact(root, 'T-999'), (error) => {
    assert.equal(error.code, 'E_CAPSULE_NOT_FOUND');
    assert.ok(error.details.searched.some((path) => path === '.planr/quick'));
    assert.deepEqual(error.details.candidates, []);
    return true;
  });
  assert.equal(await resolvePlanningArtifact(root, taskPath), taskPath);
  assert.equal(await resolvePlanningArtifact(root, 'QT-001'), '.planr/quick/QT-001-quick.md');
  const exactPathCapsule = await buildContextCapsule({
    repositoryRoot: root,
    taskSelector: taskPath,
  });
  assert.equal(exactPathCapsule.selector, 'T-068');
  await rejectCode(resolvePlanningArtifact(root, '../T-068-context.md'), 'E_CAPSULE_PATH');
});

test('broken declared parents, dependencies, Gherkin, and source limits block', async (t) => {
  const root = await fixture(t);
  await rm(join(root, storyPath));
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_NOT_FOUND',
  );
  await put(
    root,
    storyPath,
    '---\nid: "US-059"\nspecId: "SPEC-016"\n---\nRead US-059-gherkin.feature.\n',
  );
  await rm(join(root, gherkinPath));
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_NOT_FOUND',
  );
  await put(root, gherkinPath, 'Feature: Restored\n');
  await rm(join(root, `${specDir}/tasks/T-067-dependency.md`));
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_NOT_FOUND',
  );
  await put(
    root,
    `${specDir}/tasks/T-067-dependency.md`,
    '---\nid: "T-067"\nproducedInterfaces: ["src/adapter.mjs"]\n---\n',
  );
  await rm(join(root, 'src/adapter.mjs'));
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_NOT_FOUND',
  );
  await put(root, 'src/adapter.mjs', 'export const adapterVersion = 1;\n');
  await assert.rejects(
    buildContextCapsule({
      repositoryRoot: root,
      taskSelector: 'T-068',
      limits: { maxFileBytes: 40 },
    }),
    (error) => {
      assert.equal(error.code, 'E_CAPSULE_LIMIT');
      assert.equal(error.details.path, taskPath);
      return true;
    },
  );
  await put(root, taskPath, '---\nid: "T-999"\n---\n');
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_LINK',
  );
  await put(root, taskPath, '---\nid: "T-068"\ndependsOn: "T-067"\n---\n');
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_LINK',
  );
  await put(root, taskPath, '---\nid: "T-068"\ndependsOn: [\'T-067\'\n---\n');
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' }),
    'E_CAPSULE_FRONTMATTER',
  );
});

test('direct request works without .planr and can be stored privately', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'planr-direct-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(root, 'AGENTS.md', '# Instructions\n');
  const request = 'Implement a small parser.\nPreserve comments.';
  const capsule = await buildContextCapsule({ repositoryRoot: root, request });
  assert.equal(capsule.mode, 'direct-request');
  assert.equal(capsule.request, request);
  assert.match(capsule.brief, /request field/u);
  assert.ok(copied(capsule, 'AGENTS.md'));
  assert.deepEqual(
    capsule.omissions,
    [],
    'absent automatic instruction candidates are not actionable omissions',
  );
  const output = join(root, '..', `capsule-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  t.after(() => rm(output, { recursive: true, force: true }));
  const path = await writeContextCapsule(capsule, { directory: output, repositoryRoot: root });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), capsule);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(output)).mode & 0o777, 0o700);
  await rejectCode(
    writeContextCapsule(capsule, { directory: join(root, 'private'), repositoryRoot: root }),
    'E_CAPSULE_OUTPUT',
  );
});

test('optional omissions are visible, required sources and secrets block without leaking bytes', async (t) => {
  const root = await fixture(t);
  await put(root, 'src/large.txt', Buffer.alloc(100, 65));
  await put(root, 'src/.env', 'TOKEN=super-secret-value-123456789\n');
  await put(root, 'src/exposed.txt', 'CLIENT_SECRET=super-secret-value-123456789\n');
  await put(root, 'src/creds.json', '{"client_secret":"super-secret-value-123456789"}\n');
  await put(
    root,
    'src/provider.mjs',
    'const token = process.env.GITHUB_TOKEN;\nconst key = import.meta.env.API_KEY;\n',
  );
  const safe = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Update provider behavior.',
    selectedFiles: ['src/provider.mjs'],
  });
  assert.ok(copied(safe, 'src/provider.mjs'));
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Implement a parser.',
    limits: { maxFileBytes: 500 },
    optionalFiles: [
      'src/large.txt',
      'src/missing.txt',
      'src/missing.txt',
      'src/.env',
      'src/exposed.txt',
      'src/creds.json',
    ],
  });
  assert.deepEqual(
    capsule.omissions
      .filter((item) =>
        ['src/missing.txt', 'src/.env', 'src/exposed.txt', 'src/creds.json'].includes(item.path),
      )
      .map((item) => [item.path, item.reason]),
    [
      ['src/missing.txt', 'E_CAPSULE_NOT_FOUND'],
      ['src/.env', 'E_CAPSULE_SECRET'],
      ['src/exposed.txt', 'E_CAPSULE_SECRET'],
      ['src/creds.json', 'E_CAPSULE_SECRET'],
    ],
  );
  assert.ok(!JSON.stringify(capsule).includes('super-secret-value'));
  await put(root, 'AGENTS.md', Buffer.alloc(100, 65));
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Implement a parser.',
      limits: { maxFileBytes: 50 },
    }),
    'E_CAPSULE_LIMIT',
  );
  await put(root, 'AGENTS.md', '# Repository instructions\n');
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Implement a parser.',
      selectedFiles: ['src/.env'],
    }),
    'E_CAPSULE_SECRET',
  );
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Update src/exposed.txt.',
      optionalFiles: ['src/exposed.txt'],
    }),
    'E_CAPSULE_REQUIRED',
  );
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Implement a parser.',
      selectedFiles: [{ path: 'src/exposed.txt', required: false }],
    }),
    'E_CAPSULE_REQUIRED',
  );
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Implement a parser.',
      selectedFiles: ['src/missing.txt'],
    }),
    'E_CAPSULE_NOT_FOUND',
  );
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Implement a parser.',
      selectedFiles: ['src/large.txt'],
      limits: { maxFileBytes: 50 },
    }),
    'E_CAPSULE_LIMIT',
  );
  await rejectCode(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'CLIENT_SECRET=super-secret-value-123456789',
    }),
    'E_CAPSULE_SECRET',
  );
  const bounded = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Implement a parser.',
    optionalFiles: ['src/large.txt'],
    limits: { maxFileBytes: 50 },
  });
  assert.ok(
    bounded.omissions.some(
      (item) => item.path === 'src/large.txt' && item.reason === 'E_CAPSULE_LIMIT',
    ),
  );
});

test('traversal and symlink escape cannot import external selected files', async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'planr-outside-test-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, 'not-secret.txt', 'do not copy\n');
  await symlink(join(outside, 'not-secret.txt'), join(root, 'src/link.txt'));
  for (const path of [
    '../outside',
    '/etc/hosts',
    'C:/Windows/file',
    'src/../AGENTS.md',
    'src\\code.bin',
    'src/link.txt',
  ]) {
    await rejectCode(
      buildContextCapsule({
        repositoryRoot: root,
        request: 'Implement a parser.',
        selectedFiles: [path],
      }),
      'E_CAPSULE_PATH',
    );
  }
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Implement a parser.',
    optionalFiles: ['src/link.txt'],
  });
  assert.ok(
    capsule.omissions.some(
      (item) => item.path === 'src/link.txt' && item.reason === 'E_CAPSULE_PATH',
    ),
  );
  assert.ok(!JSON.stringify(capsule).includes('do not copy'));
});

test('trusted shared .planr symlink works, but a descendant escape is rejected', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'planr-symlink-source-'));
  const planning = await mkdtemp(join(tmpdir(), 'planr-symlink-planning-'));
  const outside = await mkdtemp(join(tmpdir(), 'planr-symlink-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(planning, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await put(planning, 'quick/QT-001-simple.md', '---\nid: "QT-001"\n---\n# Task\n');
  await symlink(planning, join(root, '.planr'));
  const good = await buildContextCapsule({ repositoryRoot: root, taskSelector: 'QT-001' });
  assert.ok(copied(good, '.planr/quick/QT-001-simple.md'));
  assert.deepEqual(good.planning, {
    logicalPath: join(await realpath(root), '.planr'),
    physicalPath: await realpath(planning),
    linked: true,
    updatePolicy: 'report-only',
  });
  await put(outside, 'bad.md', '---\nid: "QT-002"\n---\n');
  await symlink(join(outside, 'bad.md'), join(planning, 'quick/QT-002-bad.md'));
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, taskSelector: 'QT-002' }),
    'E_CAPSULE_NOT_FOUND',
  );
});

test('selected read-only repository material stays namespaced', async (t) => {
  const root = await fixture(t);
  const contracts = await mkdtemp(join(tmpdir(), 'planr-contracts-'));
  t.after(() => rm(contracts, { recursive: true, force: true }));
  await put(contracts, 'api/contract.json', '{"version":1}\n');
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Update caller.',
    readOnlyRepositories: [{ repositoryKey: 'contracts', root: contracts }],
    selectedFiles: [{ repositoryKey: 'contracts', path: 'api/contract.json', role: 'interface' }],
  });
  assert.equal(
    Buffer.from(
      copied(capsule, 'api/contract.json', 'contracts').contentBase64,
      'base64',
    ).toString(),
    '{"version":1}\n',
  );
  assert.deepEqual(capsule.sourceKeys, ['project', 'contracts']);
});

test('decoded context mirror exposes complete ignored task bytes without shell decoding and detects tampering', async (t) => {
  const root = await fixture(t);
  const privateRoot = await mkdtemp(join(tmpdir(), 'planr-context-mirror-'));
  t.after(() => rm(privateRoot, { recursive: true, force: true }));
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    taskSelector: 'T-068',
    selectedFiles: ['src/code.bin'],
  });
  const path = await writeContextCapsule(capsule, {
    repositoryRoot: root,
    directory: join(privateRoot, 'capsule'),
  });
  const verified = await validateContextMirror(path, capsule);
  assert.equal(verified.status, 'verified');
  const index = JSON.parse(await readFile(verified.indexPath, 'utf8'));
  assert.equal(
    index.inventory.find((file) => file.path === taskPath).readablePath,
    `project/${taskPath}`,
  );
  assert.deepEqual(
    await readFile(join(verified.directory, 'project', taskPath)),
    await readFile(join(root, taskPath)),
  );
  assert.deepEqual(
    await readFile(join(verified.directory, 'project', 'src/code.bin')),
    await readFile(join(root, 'src/code.bin')),
  );
  await writeFile(join(verified.directory, 'project', taskPath), 'tampered', { mode: 0o600 });
  await assert.rejects(validateContextMirror(path, capsule), { code: 'E_CAPSULE_MIRROR' });
  await writeFile(
    join(verified.directory, 'project', taskPath),
    await readFile(join(root, taskPath)),
  );
  await writeFile(join(verified.directory, 'unexpected.txt'), 'extra', { mode: 0o600 });
  await assert.rejects(validateContextMirror(path, capsule), { code: 'E_CAPSULE_MIRROR' });
});

test('technical dependencies remain informational unless they explicitly name a specification', async (t) => {
  const root = await fixture(t);
  await put(
    root,
    specPath,
    '---\nid: "SPEC-016"\ntech_dependencies: ["PostgreSQL 15", "Node.js", "React 19"]\n---\n# Spec\n',
  );
  const capsule = await buildContextCapsule({ repositoryRoot: root, taskSelector: 'T-068' });
  assert.equal(
    capsule.inventory.some((file) => file.roles.includes('specification-dependency')),
    false,
  );
});

test('prefixed and camelCase credentials and physical secret paths cannot enter capsules or corrections', async (t) => {
  const root = await fixture(t);
  for (const name of ['DB_PASSWORD', 'STRIPE_SECRET_KEY', 'NPM_TOKEN', 'stripeApiKey']) {
    const text = `${name}="super-secret-value-123456789"`;
    assert.throws(() => assertCredentialFreeText(text, { label: 'Correction' }), {
      code: 'E_CAPSULE_SECRET',
    });
    await put(root, 'src/assignment.txt', text);
    await assert.rejects(
      buildContextCapsule({
        repositoryRoot: root,
        request: 'fix',
        selectedFiles: ['src/assignment.txt'],
      }),
      { code: 'E_CAPSULE_SECRET' },
    );
  }
  for (const name of [
    '.envrc',
    '.netrc',
    '.git-credentials',
    'settings.tfvars',
    'settings.tfvars.json',
  ]) {
    await put(root, `src/${name}`, 'not visibly secret');
    await assert.rejects(
      buildContextCapsule({ repositoryRoot: root, request: 'fix', selectedFiles: [`src/${name}`] }),
      { code: 'E_CAPSULE_SECRET' },
    );
  }
  await put(root, 'src/.env', 'ordinary text');
  await symlink(join(root, 'src/.env'), join(root, 'src/innocent.txt'));
  await assert.rejects(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'fix',
      selectedFiles: ['src/innocent.txt'],
    }),
    { code: 'E_CAPSULE_SECRET' },
  );
  for (const text of [
    'const token = process.env.GITHUB_TOKEN;',
    'const stripeApiKey = process.env["STRIPE_SECRET_KEY"];',
    'token = os.environ["TOKEN"]',
    'const apiKey = import.meta.env.API_KEY;',
  ])
    assert.equal(assertCredentialFreeText(text), text);
});
