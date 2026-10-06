import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  EXPECTED_ROLE_IDS,
  readSkillSourceRegistry,
  readStandardSkillPackage,
} from '../../packages/skill-runtime/src/catalog.mjs';
import { projectedSkillName } from '../../scripts/skills/host-invocations.mjs';
import {
  countReadmeWords,
  PLUGIN_README_MINIMUM_WORDS,
} from '../../scripts/skills/plugin-readme.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const registry = readSkillSourceRegistry({ repoRoot: root });
const skillIds = registry.skills.map(({ skillId }) => skillId);
const forbiddenSemanticCli =
  /`(?:open)?planr\s+(?:plan|spec\s+decompose)(?:\s|`)|`planr-pipeline(?:\s|`)|PIPELINE_PACKAGE_ROOT|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA/u;

function directories(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
}

test('canonical source exposes registry-owned directly readable Protocol 1.8 packages', () => {
  assert.equal(registry.sourceFormat, 'package-v1');
  assert.equal(registry.protocolVersion, '1.8.0');
  assert.ok(skillIds.includes('planr-release'));
  assert.deepEqual(registry.aliases, []);

  for (const row of registry.skills) {
    const packageInfo = readStandardSkillPackage({ repoRoot: root, registryRow: row });
    assert.equal(packageInfo.manifest.entrypoint, 'SKILL.md');
    assert.equal(packageInfo.manifest.execution, 'host-agent');
    assert.ok(packageInfo.markdown.startsWith('---\nname: '));
    for (const legacy of [
      'SKILL.md.tmpl',
      'skill.json',
      'contribution.json',
      'modules.json',
      'host-profiles.json',
      'compatibility.json',
    ]) {
      assert.equal(
        existsSync(resolve(packageInfo.skillDir, legacy)),
        false,
        row.skillId + '/' + legacy,
      );
    }
    const moduleRoot = resolve(packageInfo.skillDir, 'modules');
    assert.equal(
      existsSync(moduleRoot) ? readdirSync(moduleRoot).length : 0,
      0,
      row.skillId + '/modules',
    );
    for (const resource of packageInfo.resources) {
      assert.ok(resource.absolute.startsWith(packageInfo.skillDir + '/'));
    }
  }
  for (const alias of ['skills/openplanr', 'skills/openplanr-unified']) {
    const aliasRoot = resolve(root, alias);
    assert.equal(existsSync(aliasRoot) ? readdirSync(aliasRoot).length : 0, 0, alias);
  }
});

test('generated host distributions contain every canonical skill and nine Claude agents', () => {
  const expected = skillIds.map(projectedSkillName).sort();
  assert.deepEqual(directories('dist/plugins/openai/openplanr/skills'), expected);
  assert.deepEqual(directories('dist/plugins/claude/openplanr/skills'), expected);
  assert.equal(
    readdirSync(resolve(root, 'dist/plugins/cursor/openplanr/rules')).filter((name) =>
      name.endsWith('.mdc'),
    ).length,
    skillIds.length,
  );
  assert.deepEqual(
    readdirSync(resolve(root, 'dist/plugins/claude/openplanr/agents'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -3))
      .sort(),
    [...EXPECTED_ROLE_IDS].sort(),
  );

  for (const host of ['openai', 'claude']) {
    const plugin = resolve(root, 'dist/plugins/' + host + '/openplanr');
    assert.equal(existsSync(resolve(plugin, 'commands')), false);
    assert.equal(existsSync(resolve(plugin, 'codex-skills')), false);
    for (const skillId of skillIds) {
      const hostSkillName = projectedSkillName(skillId);
      const projected = readFileSync(resolve(plugin, 'skills', hostSkillName, 'SKILL.md'), 'utf8');
      assert.ok(projected.length > 80);
      assert.match(projected, new RegExp(`^name: ${hostSkillName}$`, 'mu'));
      const buildManifest = resolve(plugin, 'skills', hostSkillName, 'openplanr.skill.json');
      if (host === 'openai') assert.ok(JSON.parse(readFileSync(buildManifest, 'utf8')));
      else
        assert.equal(existsSync(buildManifest), false, `${host}/${hostSkillName} build manifest`);
    }
  }
});

test('the Claude plugin ships a directory-ready README and discovery metadata', () => {
  assert.equal(countReadmeWords('one two\n```\nthree four five\n```\n`six` [seven](https://x)'), 3);

  const readmePath = 'dist/plugins/claude/openplanr/README.md';
  assert.ok(existsSync(resolve(root, readmePath)), readmePath);
  const readme = read(readmePath);
  const words = countReadmeWords(readme);
  assert.ok(
    words >= PLUGIN_README_MINIMUM_WORDS,
    `${readmePath} has ${words} words outside code blocks; need ${PLUGIN_README_MINIMUM_WORDS}`,
  );
  assert.match(readme, /skills and specialist\s+agents/u);
  assert.doesNotMatch(readme, /\b\d+ (?:skills|role agents)\b/u);
  assert.doesNotMatch(readme, /\{\{[A-Z0-9_]+\}\}/u);
  assert.equal(read('packages/cli/lib/host-packages/claude/openplanr/README.md'), readme);

  const manifest = JSON.parse(read('dist/plugins/claude/openplanr/.claude-plugin/plugin.json'));
  assert.ok(readme.includes(manifest.version), 'README names the plugin version');
  assert.equal(manifest.displayName, 'OpenPlanr');
  assert.equal(manifest.author.name, 'OpenPlanr');
  for (const field of [
    'homepage',
    'repository',
    'privacyPolicyUrl',
    'termsOfServiceUrl',
    'supportUrl',
    'documentationUrl',
  ])
    assert.ok(URL.canParse(manifest[field]), `${field}: ${manifest[field]}`);
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0);
  const icon = read('dist/plugins/claude/openplanr/.claude-plugin/icon.svg');
  assert.match(icon, /^<svg [^>]*viewBox="0 0 (\d+) \1"/u, 'the icon is a square SVG');
  assert.equal(
    read('packages/cli/lib/host-packages/claude/openplanr/.claude-plugin/icon.svg'),
    icon,
  );
});

test('the Claude plugin ships independently parseable source and pre-approves no tools', () => {
  const pluginRoot = resolve(root, 'dist/plugins/claude/openplanr');
  const files = readdirSync(pluginRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  const { transformSync } = createRequire(resolve(root, 'packages/artifact/package.json'))(
    'esbuild',
  );
  for (const file of files) {
    assert.doesNotMatch(file, /\.part-\d+|\.parts\.json$/u, 'new releases ship complete source');
    assert.doesNotMatch(
      file,
      /\.(?:wasm|node|bin|pyc|dylib|dll|exe)$/u,
      'no executable binary payload',
    );
    if (/\.(?:mjs|js)$/u.test(file))
      assert.doesNotThrow(() => transformSync(readFileSync(file, 'utf8'), { loader: 'js' }), file);
  }
  // Anthropic's directory classifies a plugin as privileged when any Markdown frontmatter
  // pre-approves tools, or when it declares hooks, monitors, MCP or LSP servers, settings,
  // or executables. The plugin stays instructions-only.
  const codexRoot = resolve(root, 'dist/plugins/openai/openplanr');
  const codexFiles = readdirSync(codexRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  for (const file of [...files, ...codexFiles].filter((path) => path.endsWith('.md'))) {
    const frontmatter = readFileSync(file, 'utf8').split('\n---\n')[0];
    assert.doesNotMatch(frontmatter, /^allowed-tools:/mu, `${file} pre-approves tools`);
  }
  for (const component of [
    'hooks',
    'hooks.json',
    'monitors',
    '.mcp.json',
    '.lsp.json',
    'settings.json',
    'bin',
    'commands',
  ])
    assert.equal(existsSync(resolve(pluginRoot, component)), false, `${component} is shipped`);
  const manifest = JSON.parse(read('dist/plugins/claude/openplanr/.claude-plugin/plugin.json'));
  for (const key of ['hooks', 'mcpServers', 'lspServers', 'settings', 'experimental'])
    assert.equal(key in manifest, false, `plugin.json declares ${key}`);
});

test('Plan, Spec, and Ship are host-native and independent of CLI or provider credentials', () => {
  for (const skillId of ['planr-plan', 'planr-spec', 'planr-ship']) {
    const source = read('skills/' + skillId + '/SKILL.md');
    assert.match(source, /active (?:coding )?session|active agent/iu);
    assert.doesNotMatch(source, forbiddenSemanticCli);
  }
  assert.match(read('skills/planr-plan/SKILL.md'), /write stories and tasks directly/iu);
  assert.match(
    read('skills/planr-ship/SKILL.md'),
    /read, edit, shell, browser, and test capabilities/iu,
  );
  assert.match(read('skills/planr-plan/SKILL.md'), /acceptanceRefs/iu);
  assert.match(read('skills/planr-plan/SKILL.md'), /reviewRisks/iu);
  assert.match(read('skills/planr-plan/SKILL.md'), /browserSurfaces/iu);
});

test('packaged Plan and Ship helpers run offline with no planr executable or model credentials', () => {
  const project = mkdtempSync(join(tmpdir(), 'openplanr-host-native-'));
  try {
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: project,
      NO_COLOR: '1',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      OLLAMA_HOST: '',
    };
    const missingRoot = resolve(project, 'missing-plan');
    const ids = spawnSync(
      process.execPath,
      [
        resolve(root, 'dist/plugins/openai/openplanr/skills/plan/scripts/planning-ids.mjs'),
        '--root',
        missingRoot,
        '--stories',
        '2',
        '--tasks',
        '2',
        '--preview',
      ],
      { cwd: project, encoding: 'utf8', env },
    );
    assert.equal(ids.status, 0, ids.stderr);
    assert.deepEqual(JSON.parse(ids.stdout).ids, {
      SPEC: [],
      US: ['US-001', 'US-002'],
      T: ['T-001', 'T-002'],
    });
    assert.equal(existsSync(missingRoot), false, 'preview must perform zero writes');

    mkdirSync(resolve(project, '.planr/specs/SPEC-001-demo/tasks'), { recursive: true });
    writeFileSync(
      resolve(project, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test', lint: 'node lint.mjs' } }),
    );
    writeFileSync(
      resolve(project, '.planr/specs/SPEC-001-demo/tasks/T-001-demo.md'),
      '## Test Requirements\n\n- AC-001: npm test\n',
    );
    const checks = spawnSync(
      process.execPath,
      [
        resolve(
          root,
          'dist/plugins/openai/openplanr/skills/ship/scripts/discover-verification.mjs',
        ),
        '--project',
        project,
        '--task',
        '.planr/specs/SPEC-001-demo/tasks/T-001-demo.md',
      ],
      { cwd: project, encoding: 'utf8', env },
    );
    assert.equal(checks.status, 0, checks.stderr);
    const report = JSON.parse(checks.stdout);
    assert.deepEqual(report.checks.slice(0, 1), [
      { command: 'npm run test', source: 'package-task-runner' },
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('optional CLI is provider-free and exposes only the classified deterministic roots', () => {
  const cli = JSON.parse(read('packages/cli/package.json'));
  const dependencies = { ...cli.dependencies, ...cli.optionalDependencies };
  for (const provider of ['@anthropic-ai/sdk', 'openai', 'ollama'])
    assert.equal(dependencies[provider], undefined);
  const commandCatalog = JSON.parse(read('docs/generated/utility-command-catalog.json'));
  const roots = new Set(commandCatalog.active.map(({ path }) => path.split(' ')[0]));
  for (const retired of ['plan', 'pipeline', 'estimate', 'refine', 'revise', 'evidence'])
    assert.equal(roots.has(retired), false);
  assert.ok(commandCatalog.retired.some(({ path }) => path === 'spec decompose'));

  const providerSourceHits = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:ts|js|mjs)$/u.test(entry.name)) {
        const bytes = readFileSync(path, 'utf8');
        if (
          /getAIProvider|generateStreamingJSON|@anthropic-ai\/sdk|from ['"]openai['"]/u.test(bytes)
        )
          providerSourceHits.push(path);
      }
    }
  };
  visit(resolve(root, 'packages/cli/src'));
  assert.deepEqual(providerSourceHits, []);
});
