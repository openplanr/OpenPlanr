import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  projectedSkillName,
  renderCursorSkillBody,
  renderNamespacedSkill,
} from '../../../../scripts/skills/host-invocations.mjs';
import { inspectOperateReviewNote } from '../../../skill-runtime/src/operate-review-note.mjs';
import { BUSINESS_EXECUTIVE_SKILL_BINDINGS } from '../../lib/operate/contracts/role-skills.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const OPERATE_SKILL_IDS = [
  'planr-operate',
  ...BUSINESS_EXECUTIVE_SKILL_BINDINGS.map(({ skillName }) => skillName),
];
const LEGACY_OPERATE_SKILL_IDS = [
  'planr-operate-ceo',
  'planr-operate-cto',
  'planr-operate-cpo',
  'planr-operate-cmo',
  'planr-operate-coo',
  'planr-operate-challenger',
  'planr-operate-chair',
];
const FORBIDDEN_EXECUTION =
  /\b(?:planr-pipeline|planr plan|planr spec decompose|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/iu;

function readWorkspace(path) {
  return readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
}

function readJson(path) {
  return JSON.parse(readWorkspace(path));
}

function skillBody(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/u, '');
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function packageFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(prefix, entry.name);
    if (entry.isDirectory()) return packageFiles(root, path);
    assert.ok(entry.isFile(), `${path}: regular packaged file`);
    return [path];
  });
}

function verifyPackageInventory(host) {
  const root = join(WORKSPACE_ROOT, `dist/plugins/${host}/openplanr`);
  const inventory = JSON.parse(readFileSync(join(root, '.openplanr-content.json'), 'utf8'));
  assert.equal(inventory.kind, 'openplanr-host-package-content');
  assert.equal(inventory.host, host === 'claude' ? 'claude-code' : host);
  assert.equal(inventory.protocolVersion, '1.8.0');
  const files = new Map(inventory.files.map(({ path, digest }) => [path, digest]));
  assert.equal(files.size, inventory.files.length, `${host}: unique inventory paths`);
  assert.deepEqual(
    [...files.keys()].sort(),
    packageFiles(root)
      .filter((path) => path !== '.openplanr-content.json')
      .sort(),
    `${host}: complete package inventory`,
  );
  for (const [path, digest] of files) {
    assert.equal(sha256(readFileSync(join(root, path))), digest, `${host}/${path}: digest`);
  }
  assert.equal(
    sha256(Buffer.from(`${JSON.stringify(inventory.files, null, 2)}\n`)),
    inventory.contentDigest,
    `${host}: content digest`,
  );
  return files;
}

function verifyOperateResources(host, skillId, skillRoot, resources, inventory) {
  for (const resource of resources.filter(({ kind }) => kind !== 'agent-metadata')) {
    const localPath = `${skillRoot}/${resource.path}`;
    const canonical = readFileSync(join(WORKSPACE_ROOT, `skills/${skillId}/${resource.path}`));
    if (!resource.path.startsWith('scripts/')) {
      assert.ok(inventory.has(localPath), `${host}/${localPath}: inventoried reference`);
      assert.deepEqual(
        readFileSync(join(WORKSPACE_ROOT, `dist/plugins/${host}/openplanr/${localPath}`)),
        canonical,
        `${skillId}: ${host} ${resource.path}`,
      );
      continue;
    }
    const sharedPath = `runtime/operate/${resource.path}`;
    assert.ok(inventory.has(sharedPath), `${host}/${sharedPath}: inventoried shared resource`);
    assert.deepEqual(
      readFileSync(join(WORKSPACE_ROOT, `dist/plugins/${host}/openplanr/${sharedPath}`)),
      canonical,
      `${skillId}: ${host} canonical shared ${resource.path}`,
    );
    if (resource.path !== 'scripts/validate-note.mjs') {
      assert.ok(!inventory.has(localPath), `${host}/${localPath}: no duplicate runtime`);
      continue;
    }
    assert.ok(inventory.has(localPath), `${host}/${localPath}: advertised launcher`);
    const launcher = readWorkspace(`dist/plugins/${host}/openplanr/${localPath}`);
    const target = JSON.stringify(posix.relative(posix.dirname(localPath), sharedPath));
    assert.ok(
      launcher.includes(`import { runOperateReviewNoteValidator as run } from ${target};`),
      `${skillId}: ${host} launcher imports the shared entry`,
    );
    assert.ok(launcher.includes(`export * from ${target};`), `${skillId}: ${host} public exports`);
    assert.match(launcher, /await run\(process\.argv\.slice\(2\)\)/u);
    assert.doesNotMatch(launcher, /https?:|npm |npx |PLANR_HOME|NODE_PATH/u);
  }
}

test('the canonical catalog contains one Operate orchestrator and seven role skills', () => {
  const catalog = readJson('adapters/manifests/canonical-skills.json');
  assert.equal(catalog.protocolVersion, '1.8.0');
  assert.equal(catalog.sourceFormat, 'package-v1');
  assert.deepEqual(catalog.aliases, []);
  assert.deepEqual(
    catalog.skillIds.filter((skillId) => OPERATE_SKILL_IDS.includes(skillId)),
    [...OPERATE_SKILL_IDS].sort(),
  );
  for (const skillId of LEGACY_OPERATE_SKILL_IDS) {
    assert.ok(!catalog.skillIds.includes(skillId), `${skillId}: retired alias`);
  }
});

test('OpenAI and Claude preserve canonical Operate instructions and one verified shared closure', () => {
  const inventories = Object.fromEntries(
    ['openai', 'claude'].map((host) => [host, verifyPackageInventory(host)]),
  );
  for (const skillId of OPERATE_SKILL_IDS) {
    const hostSkillName = projectedSkillName(skillId);
    const manifest = readJson(`skills/${skillId}/openplanr.skill.json`);
    const canonicalSkill = readWorkspace(`skills/${skillId}/SKILL.md`);

    assert.equal(manifest.execution, 'host-agent');
    assert.equal(manifest.protocolVersion, '1.8.0');
    assert.equal(
      readWorkspace(`dist/plugins/openai/openplanr/skills/${hostSkillName}/SKILL.md`),
      renderNamespacedSkill(canonicalSkill, skillId),
      `${skillId}: OpenAI SKILL.md`,
    );
    assert.equal(
      readWorkspace(`dist/plugins/claude/openplanr/skills/${hostSkillName}/SKILL.md`),
      renderNamespacedSkill(canonicalSkill, skillId),
      `${skillId}: Claude SKILL.md`,
    );
    assert.deepEqual(
      readJson(`dist/plugins/openai/openplanr/skills/${hostSkillName}/openplanr.skill.json`),
      {
        ...manifest,
        resources: manifest.resources.filter(
          ({ path, hosts }) =>
            hosts.includes('codex') &&
            (!path.startsWith('scripts/') || path === 'scripts/validate-note.mjs'),
        ),
      },
      `${skillId}: OpenAI manifest`,
    );
    assert.equal(
      existsSync(
        join(
          WORKSPACE_ROOT,
          `dist/plugins/claude/openplanr/skills/${hostSkillName}/openplanr.skill.json`,
        ),
      ),
      false,
      `${skillId}: Claude ships no build manifest`,
    );

    for (const host of ['openai', 'claude']) {
      verifyOperateResources(
        host,
        skillId,
        `skills/${hostSkillName}`,
        manifest.resources.filter(({ hosts }) =>
          hosts.includes(host === 'openai' ? 'codex' : 'claude-code'),
        ),
        inventories[host],
      );
    }
  }
});

test('Cursor rules preserve canonical Operate bodies and deterministic resources', () => {
  const cursorManifest = readJson('dist/plugins/cursor/openplanr/manifest.json');
  const canonicalCatalog = readJson('adapters/manifests/canonical-skills.json');
  const inventory = verifyPackageInventory('cursor');
  assert.equal(cursorManifest.ruleCount, canonicalCatalog.skillIds.length);

  for (const skillId of OPERATE_SKILL_IDS) {
    const manifest = readJson(`skills/${skillId}/openplanr.skill.json`);
    const rulePath = join(WORKSPACE_ROOT, `dist/plugins/cursor/openplanr/rules/${skillId}.mdc`);
    const cursorRule = readFileSync(rulePath, 'utf8');
    assert.equal(
      skillBody(cursorRule),
      renderCursorSkillBody(
        readWorkspace(`skills/${skillId}/SKILL.md`),
        skillId,
        manifest.resources,
      ),
    );
    const cursorResources = new Set(
      manifest.resources.filter(({ hosts }) => hosts.includes('cursor')).map(({ path }) => path),
    );
    for (const [, target] of cursorRule.matchAll(/\]\(([^)]+)\)/gu)) {
      const [resourcePath] = target.split(/[?#]/u, 1);
      if (!resourcePath.startsWith(`${skillId}/`)) continue;
      assert.ok(
        cursorResources.has(resourcePath.slice(skillId.length + 1)),
        `${skillId}: declared ${target}`,
      );
      assert.ok(
        existsSync(resolve(dirname(rulePath), resourcePath)),
        `${skillId}: resolved ${target}`,
      );
    }
    assert.ok(cursorManifest.rules.includes(`rules/${skillId}.mdc`));

    verifyOperateResources(
      'cursor',
      skillId,
      `rules/${skillId}`,
      manifest.resources.filter(({ hosts }) => hosts.includes('cursor')),
      inventory,
    );
  }
});

test('all packaged Operate validators execute offline through their shared closure after relocation', () => {
  const note = '# Invalid synthetic review\n';
  const expected = inspectOperateReviewNote(note, { profile: 'advisor' });
  assert.equal(expected.ok, false);
  const temporary = mkdtempSync(join(tmpdir(), 'openplanr-operate-suite-parity-'));
  try {
    const input = join(temporary, 'review.md');
    writeFileSync(input, note);
    for (const host of ['openai', 'claude', 'cursor']) {
      const plugin = join(temporary, host, 'openplanr');
      cpSync(join(WORKSPACE_ROOT, `dist/plugins/${host}/openplanr`), plugin, { recursive: true });
      for (const skillId of OPERATE_SKILL_IDS) {
        const skillRoot =
          host === 'cursor' ? `rules/${skillId}` : `skills/${projectedSkillName(skillId)}`;
        const result = spawnSync(
          process.execPath,
          [join(plugin, skillRoot, 'scripts/validate-note.mjs'), input, '--profile', 'advisor'],
          { cwd: temporary, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
        );
        assert.equal(result.status, 1, `${host}/${skillId}: ${result.stderr}`);
        assert.equal(result.stderr, '', `${host}/${skillId}: structured validation result`);
        assert.deepEqual(JSON.parse(result.stdout), expected, `${host}/${skillId}: validation`);
      }
      rmSync(join(plugin, 'runtime/operate/scripts/errors.mjs'));
      const missing = spawnSync(
        process.execPath,
        [
          join(
            plugin,
            host === 'cursor' ? 'rules/planr-ceo-review' : 'skills/ceo-review',
            'scripts/validate-note.mjs',
          ),
          input,
        ],
        { cwd: temporary, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
      );
      assert.equal(missing.status, 1, `${host}: missing closure fails`);
      assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/u);
      assert.equal(missing.stdout, '', `${host}: no source-checkout or global fallback`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('Operate dispatch is host-native and contains no model-backed subprocess', () => {
  const parent = readWorkspace('skills/planr-operate/SKILL.md');
  assert.match(parent, /Build shared context once/u);
  assert.match(parent, /in parallel when subagents are\s+available/u);
  assert.match(parent, /native structured-question UI/u);
  assert.match(parent, /If the directory is ignored by Git, continue locally/u);
  assert.match(parent, /## Action plan/u);
  assert.doesNotMatch(parent, FORBIDDEN_EXECUTION);
  assert.doesNotMatch(
    parent,
    /data\.continuation|allowedActions|packetId|assignmentId|evidence-digest/iu,
  );

  for (const { skillName } of BUSINESS_EXECUTIVE_SKILL_BINDINGS) {
    assert.match(parent, new RegExp(`\\b${skillName}\\b`, 'u'), skillName);
  }
});

test('pipeline compatibility package ships runtime contracts but no prompt distribution', () => {
  const packageJson = readJson('packages/pipeline/package.json');
  for (const path of ['adapters/', 'agents/', 'commands/', 'skills/', 'plugins/']) {
    assert.ok(!packageJson.files.includes(path), `${path}: excluded from package`);
  }
});
