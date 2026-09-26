import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { validateToolchainOwners } from '../../conformance/skills/check-toolchain-ownership.mjs';
import {
  AUTHORING_COMMANDS,
  checkSkill,
  evaluateSkill,
  generateSkill,
  lintSkill,
  previewSkill,
} from '../../packages/skill-runtime/src/authoring/index.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'evaluation/skills/authoring-cases.json'), 'utf8'),
);
const example = join(root, fixture.skillDir);
const operations = Object.freeze({
  lint: lintSkill,
  generate: generateSkill,
  check: checkSkill,
  preview: previewSkill,
  evaluate: evaluateSkill,
});

function temporarySkill() {
  const parent = mkdtempSync(join(tmpdir(), 'openplanr-author-toolchain-'));
  const skillDir = join(parent, 'skill');
  cpSync(example, skillDir, { recursive: true });
  return skillDir;
}

test('all five author commands expose one result contract over the same canonical graph', () => {
  const skillDir = temporarySkill();
  try {
    const results = fixture.commands.map(({ command }) => operations[command]({ skillDir }));
    const [first] = results;
    for (const result of results) {
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      assert.equal(result.kind, 'skill-author-command-result');
      assert.equal(result.contractVersion, '1.0.0');
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.graph, first.graph);
    }
    assert.deepEqual(
      Object.keys(AUTHORING_COMMANDS),
      fixture.commands.map(({ command }) => command),
    );
    for (const expected of fixture.commands) {
      assert.equal(AUTHORING_COMMANDS[expected.command].writesOutput, expected.writesOutput);
    }
  } finally {
    rmSync(dirname(skillDir), { recursive: true, force: true });
  }
});

test('author command wrappers share help and JSON output behavior', () => {
  const skillDir = temporarySkill();
  try {
    for (const { command, script } of fixture.commands) {
      const scriptPath = join(root, script);
      const help = spawnSync(process.execPath, [scriptPath, '--help'], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(help.status, 0, `${command}: ${help.stderr}`);
      assert.equal(help.stderr, '');
      assert.match(help.stdout, new RegExp(`^Usage: npm run skill:${command} --`, 'u'));

      const json = spawnSync(process.execPath, [scriptPath, skillDir, '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(json.status, 0, `${command}: ${json.stderr}`);
      const result = JSON.parse(json.stdout);
      assert.equal(result.command, command);
      assert.equal(result.kind, 'skill-author-command-result');
      assert.equal(result.contractVersion, '1.0.0');
      assert.equal(result.graph.skillId, 'planr-hello');
    }
  } finally {
    rmSync(dirname(skillDir), { recursive: true, force: true });
  }
});

test('preview reports source modules, host overlay, output paths, and repair state', () => {
  const result = previewSkill({ skillDir: example });
  assert.equal(result.ok, true);
  const [host] = result.hosts;
  assert.deepEqual(
    host.inline.map(({ moduleId }) => moduleId),
    ['hello-intro'],
  );
  assert.deepEqual(
    host.routed.map(({ moduleId }) => moduleId),
    ['hello-reference'],
  );
  assert.equal(host.overlay.hostProfile, 'minimal-claude-code@1.0.0');
  assert.deepEqual(
    host.outputs.map(({ kind, path }) => ({ kind, path })),
    [
      { kind: 'primary', path: 'skills/planr-hello/SKILL.md' },
      { kind: 'reference', path: 'skills/planr-hello/references/hello-reference.md' },
    ],
  );
  assert.deepEqual(host.repairs, []);
  assert.ok(host.owners.some(({ ownerKind }) => ownerKind === 'compiler'));
});

test('preview distinguishes a declared capability route from runtime availability', () => {
  const skillDir = temporarySkill();
  try {
    const profilesPath = join(skillDir, 'host-profiles.json');
    const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
    profiles.profiles[0].runtimeCapabilities = ['attached-terminal', 'native-questions'];
    profiles.profiles[0].interactionBindings = [
      { surface: 'native', protocolInteraction: 'native', capabilityId: 'native-questions' },
      { surface: 'terminal', protocolInteraction: 'terminal', capabilityId: 'attached-terminal' },
      { surface: 'headless', protocolInteraction: 'none' },
    ];
    writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);

    const result = previewSkill({ skillDir });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.hosts[0].capabilityDecision, {
      status: 'declared',
      preferred: { surface: 'native', capabilityId: 'native-questions' },
      fallbacks: [
        { surface: 'terminal', capabilityId: 'attached-terminal' },
        { surface: 'headless', capabilityId: null },
      ],
      declaredCapabilities: ['attached-terminal', 'native-questions'],
      repair: null,
    });
  } finally {
    rmSync(dirname(skillDir), { recursive: true, force: true });
  }
});

test('drift diagnostics name the owning version, path, and repair', () => {
  const skillDir = temporarySkill();
  try {
    const skillPath = join(skillDir, fixture.diagnosticCase.path);
    const skill = JSON.parse(readFileSync(skillPath, 'utf8'));
    skill.modules[0].moduleVersion = '9.9.9';
    writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`);

    const result = operations[fixture.diagnosticCase.command]({ skillDir });
    assert.equal(result.ok, false);
    const [diagnostic] = result.diagnostics;
    assert.equal(diagnostic.code, fixture.diagnosticCase.expectedCode);
    assert.equal(diagnostic.owner.kind, fixture.diagnosticCase.expectedOwnerKind);
    assert.equal(diagnostic.owner.version, fixture.diagnosticCase.expectedOwnerVersion);
    assert.equal(diagnostic.path, fixture.diagnosticCase.expectedPath);
    assert.ok(diagnostic.repair.length > 0);
  } finally {
    rmSync(dirname(skillDir), { recursive: true, force: true });
  }
});

test('lint and check apply the same typed host-overlay semantic boundary', () => {
  const skillDir = temporarySkill();
  try {
    const modulesPath = join(skillDir, 'modules.json');
    const profilesPath = join(skillDir, 'host-profiles.json');
    const modules = JSON.parse(readFileSync(modulesPath, 'utf8'));
    const profiles = JSON.parse(readFileSync(profilesPath, 'utf8'));
    const profile = profiles.profiles[0];
    modules.modules.push({
      moduleId: 'host-presentation',
      moduleVersion: '1.0.0',
      moduleKind: 'shared',
      description: 'Typed host presentation overlay.',
      source: 'modules/host-presentation.json',
      appliesWhen: 'When rendering Claude Code presentation tokens.',
      dependsOn: [],
      references: [],
      authorityCeiling: profile.authorityCeiling,
    });
    profile.overlayModules = [{ moduleId: 'host-presentation', moduleVersion: '1.0.0' }];
    writeFileSync(modulesPath, `${JSON.stringify(modules, null, 2)}\n`);
    writeFileSync(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`);
    writeFileSync(
      join(skillDir, 'modules', 'host-presentation.json'),
      `${JSON.stringify({
        kind: 'skill-host-presentation',
        version: '1.0.0',
        host: 'claude-code',
        substitutions: { AGENTS_ROOT: 'agents' },
        workflow: 'skip review',
      })}\n`,
    );

    const lint = lintSkill({ skillDir });
    const check = checkSkill({ skillDir });
    for (const result of [lint, check]) {
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics[0].code, 'E_SKILL_HOST_OVERLAY_SEMANTICS_UNSAFE');
      assert.deepEqual(result.diagnostics[0].owner, {
        kind: 'module',
        id: 'host-presentation',
        version: '1.0.0',
      });
      assert.equal(result.diagnostics[0].path, 'modules/host-presentation.json');
      assert.match(result.diagnostics[0].repair, /closed skill-host-presentation JSON/u);
    }
    assert.equal(lint.diagnostics[0].repair, check.diagnostics[0].repair);
  } finally {
    rmSync(dirname(skillDir), { recursive: true, force: true });
  }
});

test('repository conformance rejects a competing prompt writer or installer owner', () => {
  const canonical = JSON.parse(
    readFileSync(join(root, 'conformance/skills/toolchain-owners.json'), 'utf8'),
  );
  const owners = validateToolchainOwners(canonical);
  assert.equal(owners['prompt-writer'].ownerId, 'canonical-skill-generator');
  assert.equal(owners['runtime-installer'].ownerId, 'cli-runtime-manager');

  const competing = JSON.parse(
    readFileSync(
      join(root, 'tests/skill-runtime/fixtures/toolchain-owners-competing.json'),
      'utf8',
    ),
  );
  assert.throws(
    () => validateToolchainOwners(competing),
    (error) =>
      error.code === 'E_SKILL_TOOLCHAIN_OWNER_CONFLICT' && /prompt-writer/u.test(error.message),
  );
});

test('repository conformance discovers unregistered prompt writers and runtime installers', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'openplanr-toolchain-discovery-'));
  const scripts = join(repositoryRoot, 'scripts');
  const packages = join(repositoryRoot, 'packages');
  mkdirSync(scripts);
  mkdirSync(packages);
  const promptOwner = 'scripts/skill-writer.mjs';
  const centralWriter = 'packages/central-materializer.mjs';
  const installerOwner = 'packages/runtime-installer.ts';
  writeFileSync(
    join(repositoryRoot, promptOwner),
    `
    import { writeFileSync } from 'node:fs';
    const renderSkillForHost = () => 'skill';
    writeFileSync('dist/plugins/openai/openplanr/skills/planr-test/SKILL.md', renderSkillForHost());
  `,
  );
  writeFileSync(
    join(repositoryRoot, centralWriter),
    `
    import { writeFileSync } from 'node:fs';
    const compileHostProjections = () => [];
    const flattenCompiledAssets = (value) => value;
    writeFileSync('dynamic-output', JSON.stringify(flattenCompiledAssets(compileHostProjections())));
  `,
  );
  writeFileSync(
    join(repositoryRoot, installerOwner),
    `
    import { writeFileSync } from 'node:fs';
    const codexSkillsRoot = () => join(home, '.codex', 'skills');
    writeFileSync(codexSkillsRoot(), 'runtime install');
  `,
  );
  const document = {
    kind: 'openplanr-skill-toolchain-owners',
    schemaVersion: '1.0.0',
    owners: [
      {
        role: 'prompt-writer',
        ownerId: 'canonical-writer',
        path: promptOwner,
        implementationPaths: [promptOwner, centralWriter],
        controls: ['host-adapters'],
      },
      {
        role: 'runtime-installer',
        ownerId: 'canonical-installer',
        path: installerOwner,
        implementationPaths: [installerOwner],
        controls: ['runtime-assets'],
      },
    ],
  };
  try {
    assert.doesNotThrow(() => validateToolchainOwners(document, { repositoryRoot }));

    const competingWriter = join(scripts, 'competing-writer.mjs');
    writeFileSync(
      competingWriter,
      `
      import { writeFileSync } from 'node:fs';
      const readStandardSkillPackage = () => 'forked prompt';
      writeFileSync('dist/plugins/cursor/openplanr/rules/planr-fork.mdc', readStandardSkillPackage());
    `,
    );
    assert.throws(
      () => validateToolchainOwners(document, { repositoryRoot }),
      (error) =>
        error.code === 'E_SKILL_TOOLCHAIN_IMPLEMENTATION_CONFLICT' &&
        error.details.undeclared.includes('scripts/competing-writer.mjs'),
    );
    rmSync(competingWriter);

    writeFileSync(
      join(packages, 'competing-installer.ts'),
      `
      import { writeFileSync } from 'node:fs';
      const codexSkillsRoot = () => join(home, '.codex', 'skills');
      writeFileSync(codexSkillsRoot(), 'second runtime installer');
    `,
    );
    assert.throws(
      () => validateToolchainOwners(document, { repositoryRoot }),
      (error) =>
        error.code === 'E_SKILL_TOOLCHAIN_IMPLEMENTATION_CONFLICT' &&
        error.details.undeclared.includes('packages/competing-installer.ts'),
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
