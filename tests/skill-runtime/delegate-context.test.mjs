import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCredentialFreeText,
  buildContextCapsule,
  containsSecret,
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

test('credential detection distinguishes complete literals from source expressions', async (t) => {
  const root = await fixture(t);
  const source = [
    'const secret = readArtifactSecretInput(inputPath);',
    'const token = provider.credentials.accessToken;',
    'const clientSecret = options.authentication.clientSecret;',
    'const apiKey = await readConfiguredApiKey();',
    'token: readConfiguredAccessToken(),',
    'secret = readArtifactSecretInput(inputPath)',
    'const token = process.env.GITHUB_TOKEN;',
    'const stripeApiKey = process.env["STRIPE_SECRET_KEY"];',
    'const apiKey = import.meta.env.API_KEY;',
    'token = os.environ["TOKEN"]',
    'token = process.env.GITHUB_TOKEN',
    'token = import.meta.env.API_KEY',
    'token = env.GITHUB_ACCESS_TOKEN',
    'const secret = `$' + '{process.env.CLIENT_SECRET}`;',
    "const status = { accessToken: 'never-return-token' };",
    'const status = { accessToken: "mock-access-token" };',
  ].join('\n');
  assert.equal(assertCredentialFreeText(source), source);
  await put(root, 'src/provider.mjs', source);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Review provider behavior.',
    selectedFiles: ['src/provider.mjs'],
  });
  assert.deepEqual(
    Buffer.from(copied(capsule, 'src/provider.mjs').contentBase64, 'base64'),
    Buffer.from(source),
  );

  for (const text of [
    'const token = "super-secret-value-123456789";',
    'const PASSWORD = "ReviewFixturePassword123!";',
    "const clientSecret = 'Synthetic-Credential-123!@#$%^&*()';",
    'PASSWORD=Synthetic-Credential-123!@%&*',
    '{"client_secret":"synthetic credential with spaces!"}',
    "const secret = 'super-secret-value-123456789';",
    'const apiKey = `super-secret-value-123456789`;',
    '{"accessToken":"super-secret-value-123456789"}',
    'CLIENT_SECRET=super-secret-value-123456789',
    'export API_KEY=super-secret-value-123456789 # private',
    '  password: super-secret-value-123456789\r\n',
    'token = super-secret-value-123456789',
    'const token = "never-return-token"; const secret = "super-secret-value-123456789";',
    'TOKEN=never-return-token\nCLIENT_SECRET=super-secret-value-123456789\n',
  ]) {
    assert.equal(containsSecret(Buffer.from(text)), true, text);
    assert.throws(() => assertCredentialFreeText(text), { code: 'E_CAPSULE_SECRET' });
  }
});

test('dummy literals do not exempt recognizable credentials or credential files', async (t) => {
  const root = await fixture(t);
  for (const text of [
    'const token = "example-value-for-documentation";',
    'const token = "placeholder-access-token";',
    'const token = "your-access-token-here";',
    'const token = "never-return-token";',
    'const token = "test-access-token";',
    'ACCESS_TOKEN=never-return-token',
    'JWT_SECRET=change-me-in-production',
    'CLIENT_SECRET=replace-me-before-use',
  ])
    assert.equal(containsSecret(Buffer.from(text)), false, text);

  for (const value of [
    `ghp_${'A'.repeat(30)}`,
    `github_pat_${'A'.repeat(30)}`,
    `sk-proj-${'A'.repeat(30)}`,
    `xoxb-${'A'.repeat(30)}`,
    `AKIA${'A'.repeat(16)}`,
    '-----BEGIN PRIVATE KEY-----',
  ]) {
    const text = `const token = "example-${value}";`;
    assert.equal(containsSecret(Buffer.from(text)), true);
    await put(root, 'src/fixture.test.mjs', text);
    await rejectCode(
      buildContextCapsule({
        repositoryRoot: root,
        request: 'Review the test.',
        selectedFiles: ['src/fixture.test.mjs'],
      }),
      'E_CAPSULE_SECRET',
    );
  }
  await put(root, 'src/.env', 'ACCESS_TOKEN=never-return-token\n');
  await rejectCode(
    buildContextCapsule({ repositoryRoot: root, request: 'fix', selectedFiles: ['src/.env'] }),
    'E_CAPSULE_SECRET',
  );
});

test('reading order prioritizes requirements without removing or truncating any required source', async (t) => {
  const root = await fixture(t);
  await put(root, 'background.md', 'Optional background\n');
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    taskSelector: 'T-068',
    selectedFiles: ['src/code.bin'],
    optionalFiles: ['background.md'],
  });
  assert.equal(capsule.readingOrder[0], 'project/AGENTS.md');
  assert.ok(
    capsule.readingOrder.indexOf(`project/${taskPath}`) <
      capsule.readingOrder.indexOf('project/src/code.bin'),
  );
  assert.equal(capsule.readingOrder.at(-1), 'project/background.md');
  assert.deepEqual(
    new Set(capsule.readingOrder),
    new Set(capsule.inventory.map(({ repositoryKey, path }) => `${repositoryKey}/${path}`)),
  );
  const parent = await mkdtemp(join(tmpdir(), 'planr-reading-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const path = await writeContextCapsule(capsule, {
    repositoryRoot: root,
    directory: join(parent, 'capsule'),
  });
  const index = JSON.parse(await readFile(join(parent, 'capsule/readable/index.json'), 'utf8'));
  assert.deepEqual(index.readingOrder, capsule.readingOrder);
  assert.deepEqual(
    await readFile(join(parent, 'capsule/readable/project/src/code.bin')),
    await readFile(join(root, 'src/code.bin')),
  );
  assert.equal((await validateContextMirror(path, capsule)).status, 'verified');
  // Historical capsules keep the original mirror shape and remain verifiable.
  delete capsule.readingOrder;
  const legacy = await writeContextCapsule(capsule, {
    repositoryRoot: root,
    directory: join(parent, 'legacy'),
  });
  assert.equal((await validateContextMirror(legacy, capsule)).status, 'verified');
});

const REPORTED_SOURCE = [
  'export const recording = {',
  '  secret: recording.secretAccessKey,',
  '};',
  'interface Booking {',
  '  issueLiveKitToken: TIssueLiveKitBookingToken;',
  '}',
  'export const settings = {',
  '  apiKey: configValidation.config!.apiKey,',
  '  apiSecret: configValidation.config!.apiSecret,',
  '};',
  'export const fixture = {',
  '  apiSecret: "test_secret_must_be_at_least_32_bytes_long_",',
  '};',
  '',
].join('\n');

async function secretError(promise) {
  let caught;
  await assert.rejects(promise, (error) => {
    caught = error;
    return error.code === 'E_CAPSULE_SECRET';
  });
  assert.ok(!JSON.stringify({ ...caught.details, message: caught.message }).includes('Xk8sP2m'));
  return caught;
}

test('reported references, type annotations and a synthetic fixture are delegated unchanged', async (t) => {
  const root = await fixture(t);
  for (const line of REPORTED_SOURCE.split('\n'))
    assert.equal(assertCredentialFreeText(line), line);
  await put(root, 'src/booking.ts', REPORTED_SOURCE);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Review booking credentials.',
    selectedFiles: ['src/booking.ts'],
  });
  assert.deepEqual(
    Buffer.from(copied(capsule, 'src/booking.ts').contentBase64, 'base64'),
    Buffer.from(REPORTED_SOURCE),
  );
  assert.equal(capsule.credentialResolutions, undefined);
});

test('a blocked source reports masked findings with location, rule, classification and confidence', async (t) => {
  const root = await fixture(t);
  const mixed = `${REPORTED_SOURCE}export const live = {\n  apiKey: "Xk8sP2mQ9vR4tL7wYz2N",\n};\n`;
  await put(root, 'src/mixed.ts', mixed);
  const error = await secretError(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Review keys.',
      selectedFiles: ['src/mixed.ts'],
    }),
  );
  assert.deepEqual(
    error.details.findings.map(
      ({ rule, classification, confidence, resolvable, key, location }) => ({
        rule,
        classification,
        confidence,
        resolvable,
        key,
        location,
      }),
    ),
    [
      {
        rule: 'credential-assignment',
        classification: 'possible-credential',
        confidence: 'medium',
        resolvable: true,
        key: 'apiKey',
        location: { path: 'src/mixed.ts', line: 15, column: 3 },
      },
    ],
  );
  assert.match(error.details.findings[0].explanation, /apiKey is assigned a literal/u);
  assert.match(error.details.contentDigest, /^sha256:[a-f0-9]{64}$/u);
  const optional = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Review keys.',
    optionalFiles: ['src/mixed.ts'],
  });
  const written = {
    repositoryKey: 'project',
    path: 'src/mixed.ts',
    role: 'selected-source',
    reason: 'E_CAPSULE_SECRET',
  };
  assert.deepEqual(
    optional.omissions.find(({ path }) => path === 'src/mixed.ts'),
    written,
  );
  assert.deepEqual(
    previewContextCapsule(optional).omissions.find(({ path }) => path === 'src/mixed.ts'),
    { ...written, findings: error.details.findings, contentDigest: error.details.contentDigest },
  );
  assert.ok(!JSON.stringify(optional).includes('Xk8sP2m'));
  const parent = await mkdtemp(join(tmpdir(), 'planr-omission-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const path = await writeContextCapsule(optional, {
    repositoryRoot: root,
    directory: join(parent, 'capsule'),
  });
  for (const file of [path, join(parent, 'capsule/readable/index.json')]) {
    const { omissions } = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(
      omissions.find(({ path }) => path === 'src/mixed.ts'),
      written,
      file,
    );
    assert.ok(!(await readFile(file, 'utf8')).includes(error.details.contentDigest), file);
  }
});

test('a finding names only the credential word, never the rest of the name', () => {
  let details;
  assert.throws(
    () => assertCredentialFreeText(`ghp_${'D'.repeat(30)}_TOKEN = "abcdefghijklmnopqrstuvwxyz"`),
    (error) => {
      ({ details } = error);
      return error.code === 'E_CAPSULE_SECRET';
    },
  );
  assert.deepEqual(
    details.findings.map(({ rule, key }) => [rule, key]),
    [
      ['credential-format', undefined],
      ['credential-assignment', 'TOKEN'],
    ],
  );
  assert.ok(!JSON.stringify(details).includes('D'.repeat(30)));
});

test('a recorded resolution covers only its finding in the exact content', async (t) => {
  const root = await fixture(t);
  const content = 'export const live = {\n  apiKey: "Xk8sP2mQ9vR4tL7wYz2N",\n};\n';
  await put(root, 'src/live.ts', content);
  const input = { repositoryRoot: root, request: 'Review keys.', selectedFiles: ['src/live.ts'] };
  const { details } = await secretError(buildContextCapsule(input));
  const resolution = { id: details.findings[0].id, contentDigest: details.contentDigest };
  const capsule = await buildContextCapsule({ ...input, credentialResolutions: [resolution] });
  assert.deepEqual(
    Buffer.from(copied(capsule, 'src/live.ts').contentBase64, 'base64'),
    Buffer.from(content),
  );
  assert.deepEqual(capsule.credentialResolutions, [
    {
      ...resolution,
      repositoryKey: 'project',
      path: 'src/live.ts',
      rule: 'credential-assignment',
      location: { path: 'src/live.ts', line: 2, column: 3 },
    },
  ]);
  assert.deepEqual(
    previewContextCapsule(capsule).credentialResolutions,
    capsule.credentialResolutions,
  );

  await put(root, 'src/live.ts', `${content}// changed\n`);
  await secretError(buildContextCapsule({ ...input, credentialResolutions: [resolution] }));
  await put(root, 'src/live.ts', content);
  await secretError(
    buildContextCapsule({
      ...input,
      credentialResolutions: [{ ...resolution, id: 'cred_0000000000000000' }],
    }),
  );

  const recognizable = `export const token = "ghp_${'A'.repeat(30)}";\n`;
  await put(root, 'src/live.ts', recognizable);
  const format = await secretError(buildContextCapsule(input));
  assert.equal(format.details.findings[0].resolvable, false);
  await secretError(
    buildContextCapsule({
      ...input,
      credentialResolutions: format.details.findings.map(({ id }) => ({
        id,
        contentDigest: format.details.contentDigest,
      })),
    }),
  );
  await rejectCode(
    buildContextCapsule({ ...input, credentialResolutions: [{ id: 'all' }] }),
    'E_CAPSULE_INPUT',
  );
});

test('a direct request uses the same findings and resolutions', async (t) => {
  const root = await fixture(t);
  const request = 'Rotate the staging key.\nAPI_KEY=Xk8sP2mQ9vR4tL7wYz2N\n';
  const { details } = await secretError(buildContextCapsule({ repositoryRoot: root, request }));
  assert.deepEqual(details.findings[0].location, { line: 2, column: 1 });
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request,
    credentialResolutions: [{ id: details.findings[0].id, contentDigest: details.contentDigest }],
  });
  assert.equal(capsule.request, request);
  assert.equal(capsule.credentialResolutions[0].source, 'request');
});

test('file syntax decides whether an unquoted value is a reference or a literal', async (t) => {
  const root = await fixture(t);
  const line = 'api_key: recording.secretAccessKey\n';
  await put(root, 'src/settings.ts', line);
  await put(root, 'config/settings.yaml', line);
  const code = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Review settings.',
    selectedFiles: ['src/settings.ts'],
  });
  assert.ok(copied(code, 'src/settings.ts'));
  await secretError(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Review settings.',
      selectedFiles: ['config/settings.yaml'],
    }),
  );
  for (const text of [
    'PASSWORD: correcthorsebatterystaple',
    'API_KEY=Xk8sP2mQ9vR4tL7wYz2N',
    'token: a8f3k2j9d0s7h6g5;',
  ])
    assert.equal(containsSecret(Buffer.from(text)), true, text);
});

async function blockedWithout(promise, value) {
  const error = await secretError(promise);
  assert.ok(!JSON.stringify({ ...error.details, message: error.message }).includes(value));
  return error;
}

const STRING_BLOCKS = {
  'src/app.py': 'DOC = """\n    password: CorrectHorseBatteryStaple\n"""\n',
  'src/raw.py': 'DOC = rf"""\n    password: CorrectHorseBatteryStaple\n"""\n',
  'src/doc.js': 'const doc = `\npassword: CorrectHorseBatteryStaple\n`;\n',
  'src/doc.go': 'var doc = `\npassword: CorrectHorseBatteryStaple\n`\n',
  'src/Doc.java': 'String doc = """\n    password: CorrectHorseBatteryStaple\n    """;\n',
  'src/doc.php': '<?php\n$doc = <<<EOT\npassword: CorrectHorseBatteryStaple\nEOT;\n',
  'src/doc.rb': 'doc = <<~ENV\n  password: CorrectHorseBatteryStaple\nENV\n',
  'src/Doc.vue': '<i18n lang="yaml">\npassword: CorrectHorseBatteryStaple\n</i18n>\n',
};

test('identifier-shaped values in strings, free-text assignments and text files are literals', async (t) => {
  const root = await fixture(t);
  for (const [path, content] of Object.entries(STRING_BLOCKS)) {
    await put(root, path, content);
    await blockedWithout(
      buildContextCapsule({ repositoryRoot: root, request: 'Review.', selectedFiles: [path] }),
      'CorrectHorse',
    );
  }
  for (const text of [
    'export DB_PASSWORD=CorrectHorseBatteryStaple;',
    'API_TOKEN=correct.horse.battery.staple',
  ]) {
    assert.throws(() => assertCredentialFreeText(text, { label: 'Correction' }), {
      code: 'E_CAPSULE_SECRET',
    });
    await blockedWithout(buildContextCapsule({ repositoryRoot: root, request: text }), 'orrect');
  }
  for (const [path, content] of [
    ['bin/deploy', '#!/bin/sh\nAPI_TOKEN=correct.horse.battery.staple\n'],
    ['docs/deploy.md', '---\nAPI_TOKEN=correct.horse.battery.staple\n---\n# Deploy\n'],
    ['docs/notes.md', '---\napi_token: correct.horse.battery.staple\n---\n# Notes\n'],
  ]) {
    await put(root, path, content);
    await blockedWithout(
      buildContextCapsule({ repositoryRoot: root, request: 'Review.', selectedFiles: [path] }),
      'horse',
    );
  }
});

test('recognizable formats after a marker or under a private_key field are not resolvable', async (t) => {
  const root = await fixture(t);
  for (const content of [
    `const token = "mock_ghp_${'A'.repeat(36)}";\n`,
    `client("mock_ghp_${'A'.repeat(36)}");\n`,
    `const key = "test_sk-proj-${'A'.repeat(40)}";\n`,
    '{"private_key": "-----BEGIN PGP PRIVATE KEY BLOCK-----\\nAAAA"}\n',
    '{"private_key": "-----BEGIN ENCRYPTED DATA-----"}\n',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----\n',
    `const token = "xoxb-${'A'.repeat(25)}_x";\n`,
  ]) {
    await put(root, 'src/fixture.ts', content);
    const { details } = await blockedWithout(
      buildContextCapsule({
        repositoryRoot: root,
        request: 'Review.',
        selectedFiles: ['src/fixture.ts'],
      }),
      'AAAA',
    );
    assert.ok(
      details.findings.some(
        ({ rule, resolvable }) => rule === 'credential-format' && resolvable === false,
      ),
      content,
    );
  }
  assert.equal(containsSecret(Buffer.from(`const id = "task-${'A'.repeat(40)}";`)), false);
});

test('a described placeholder needs a credential noun', async (t) => {
  const root = await fixture(t);
  for (const [path, content] of [
    ['src/settings.ts', 'password = "test-cobalt-river-lamp-9127"\n'],
    ['config/settings.yaml', 'password: fixture.cobalt.river.lamp.9127\n'],
  ]) {
    await put(root, path, content);
    await blockedWithout(
      buildContextCapsule({ repositoryRoot: root, request: 'Review.', selectedFiles: [path] }),
      'cobalt',
    );
  }
  assert.throws(() => assertCredentialFreeText('password: "mock correct horse battery staple"'), {
    code: 'E_CAPSULE_SECRET',
  });
  for (const text of [
    'apiSecret: "test_secret_must_be_at_least_32_bytes_long_",',
    'password: "fixture-password-for-login-tests"',
    'TOKEN=mock.token.value.for.tests.only',
    'token: "fixture-read-credential",',
    'password: "fixture-alternate-credential",',
    'secret: "mock-shared-secrets-for-tests",',
  ])
    assert.equal(assertCredentialFreeText(text), text);
});

test('identifiers and slugs that contain a token prefix are not credential formats', async (t) => {
  const root = await fixture(t);
  const names = [
    'parse_ghs_installation_token_header',
    'MAX_GHS_TOKEN_LENGTH_FOR_INSTALLATIONS = 40',
    'strip_ghp_prefix_from_token_value',
    'how_to_use_sk-learn_pipelines_for_production',
  ];
  for (const name of names) assert.equal(assertCredentialFreeText(name), name);
  const source = `${names.map((name) => `# ${name}`).join('\n')}\n`;
  await put(root, 'src/names.py', source);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Review names.',
    selectedFiles: ['src/names.py'],
  });
  assert.deepEqual(
    Buffer.from(copied(capsule, 'src/names.py').contentBase64, 'base64'),
    Buffer.from(source),
  );
});

test('shell and env assignment lines are literals in any file', async (t) => {
  const root = await fixture(t);
  for (const [path, content, value] of [
    [
      'src/deploy.rb',
      'script = <<~SH\n  export DB_PASSWORD=CorrectHorseBatteryStaple;\nSH\n',
      'CorrectHorse',
    ],
    ['src/env.js', 'const env = `\nAPI_TOKEN=QzWxEcRvTbYnUmIoPa;\n`;\n', 'QzWx'],
  ]) {
    await put(root, path, content);
    await blockedWithout(
      buildContextCapsule({ repositoryRoot: root, request: 'Review.', selectedFiles: [path] }),
      value,
    );
  }
  const call =
    'client = Client(\n    api_key=settings.api_key,\n    token=credentials.access_token,\n)\n';
  await put(root, 'src/client.py', call);
  const capsule = await buildContextCapsule({
    repositoryRoot: root,
    request: 'Review.',
    selectedFiles: ['src/client.py'],
  });
  assert.ok(copied(capsule, 'src/client.py'));
});

test('a link is classified by its target, and configuration wins', async (t) => {
  const root = await fixture(t);
  await put(root, 'config/settings.yaml', 'api_key: recording.secretAccessKey\n');
  await symlink(join(root, 'config/settings.yaml'), join(root, 'src/settings.ts'));
  await secretError(
    buildContextCapsule({
      repositoryRoot: root,
      request: 'Review settings.',
      selectedFiles: ['src/settings.ts'],
    }),
  );
});

test('findings in text that takes no resolution are not resolvable', () => {
  assert.throws(
    () =>
      assertCredentialFreeText('API_KEY=Xk8sP2mQ9vR4tL7wYz2N', {
        code: 'E_DELEGATE_INPUT',
        label: 'Correction',
      }),
    ({ code, details }) =>
      code === 'E_DELEGATE_INPUT' &&
      details.findings.length === 1 &&
      details.findings.every(
        ({ resolvable, explanation }) =>
          resolvable === false && !/resolve this finding/u.test(explanation),
      ),
  );
});
