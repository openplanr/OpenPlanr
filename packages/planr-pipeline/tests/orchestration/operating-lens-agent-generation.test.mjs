import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  OperatingAssetGenerationError,
  renderOperatingAssets,
  renderOperatingLensAgentAssets,
  renderOperatingLensAgentDocs,
  runOperatingAssetGenerator,
} from '../../scripts/generate-operating-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The bounded, read-only grant every mission-mode lens must carry, expressed as a
// Claude Code `tools:` string. Deliberately spelled out here so the test fails if
// the mapping ever widens toward a write/exec/unscoped-Bash capability.
const EXPECTED_TOOLS =
  'Read, Glob, Grep, Bash(git log:*), Bash(git show:*), Bash(git diff:*), Bash(git blame:*)';

// The nine canonical delivery agents (task Preserve list). A generated lens agent
// path must never equal any of these.
const CANONICAL_DELIVERY_AGENTS = [
  'agents/backend-agent.md',
  'agents/frontend-agent.md',
  'agents/db-agent.md',
  'agents/designer-agent.md',
  'agents/specification-agent.md',
  'agents/qa-agent.md',
  'agents/devops-agent.md',
  'agents/doc-gen-agent.md',
  'agents/entity-scaffold-agent.md',
];

const MISSION_ROLE_IDS = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
  'chair',
];

// Every file renderOperatingAssets reads from disk, so the drift machinery can run
// against an isolated projectRoot.
const SEED_FILES = [
  'package.json',
  'registry/adapters.json',
  'registry/operating-roles.json',
  'registry/operating-providers.json',
  'templates/runtime/planr-operate-skill.md.tpl',
  'templates/runtime/planr-operate-cursor.mdc.tpl',
  'templates/runtime/planr-operate-command.md.tpl',
  'templates/runtime/operating-lens-agent.md.tpl',
];

function seedProjectRoot() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-lens-agents-'));
  for (const rel of SEED_FILES) {
    const target = join(projectRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(root, rel), 'utf8'), 'utf8');
  }
  return projectRoot;
}

function readRoles() {
  return JSON.parse(readFileSync(join(root, 'registry/operating-roles.json'), 'utf8'));
}

function toolsLine(agentText) {
  const match = agentText.match(/^tools:\s*(.+)$/mu);
  assert.ok(match, 'generated agent has a tools: frontmatter line');
  return match[1];
}

test('generator emits exactly one bounded read-only agent per mission-mode lens', () => {
  const assets = renderOperatingLensAgentAssets(readRoles());
  const targets = Object.keys(assets).sort();

  assert.deepEqual(
    targets,
    MISSION_ROLE_IDS.map((id) => `agents/operating/${id}.md`).sort(),
    'one agents/operating/<role-id>.md per mission role, no more, no less',
  );

  for (const [target, text] of Object.entries(assets)) {
    const line = toolsLine(text);
    assert.equal(line, EXPECTED_TOOLS, `${target} carries only the bounded read-only grant`);
    // Never a write, execute, or unscoped capability in the grant itself.
    assert.doesNotMatch(line, /\bEdit\b/u, `${target} tools grant has no Edit`);
    assert.doesNotMatch(line, /\bWrite\b/u, `${target} tools grant has no Write`);
    assert.doesNotMatch(line, /Bash\(\*\)/u, `${target} tools grant has no unscoped Bash`);
    assert.match(text, /^model:\s*claude-sonnet-5$/mu, `${target} pins the analysis-tier model`);
    assert.match(text, /read-only Operating Board advisory lens/u);
    assert.match(text, /never appears in\s*\n?`registry\/roles\.json`|registry\/roles\.json/u);
  }
});

test('every generated lens-agent path is namespaced away from the nine delivery agents', () => {
  const assets = renderOperatingLensAgentAssets(readRoles());
  for (const target of Object.keys(assets)) {
    assert.ok(target.startsWith('agents/operating/'), `${target} lives under agents/operating/`);
    assert.ok(
      !CANONICAL_DELIVERY_AGENTS.includes(target),
      `${target} does not collide with a canonical delivery agent`,
    );
  }
});

test('renderOperatingAssets folds the lens agents + companion doc into the drift-checked map', () => {
  const assets = renderOperatingAssets();
  for (const id of MISSION_ROLE_IDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(assets, `agents/operating/${id}.md`),
      `renderOperatingAssets includes agents/operating/${id}.md`,
    );
  }
  assert.ok(
    Object.prototype.hasOwnProperty.call(assets, 'docs/generated/operating-lens-agents.md'),
    'renderOperatingAssets includes the companion doc',
  );
  // Same drift machinery as the pre-existing targets: on-disk must match generated.
  for (const target of [
    ...MISSION_ROLE_IDS.map((id) => `agents/operating/${id}.md`),
    'docs/generated/operating-lens-agents.md',
  ]) {
    assert.equal(
      readFileSync(join(root, target), 'utf8'),
      assets[target],
      `${target} must be regenerated with npm run generate:operating-assets`,
    );
  }
});

test('--check passes after generation and fails naming a hand-edited lens agent', () => {
  const projectRoot = seedProjectRoot();
  try {
    const written = runOperatingAssetGenerator({ argv: [], projectRoot });
    assert.equal(written.mode, 'write');
    for (const id of MISSION_ROLE_IDS) {
      assert.ok(written.written.includes(`agents/operating/${id}.md`), `wrote agents/operating/${id}.md`);
    }
    assert.ok(written.written.includes('docs/generated/operating-lens-agents.md'), 'wrote companion doc');

    // Immediately after generation, the drift check is clean.
    assert.deepEqual(
      runOperatingAssetGenerator({ argv: ['--check'], projectRoot }),
      { ok: true, mode: 'check', staleTargets: [] },
    );

    // Hand-edit one generated agent out of sync with the registry.
    const drifted = 'agents/operating/strategy-finance.md';
    const path = join(projectRoot, drifted);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nhand edit\n`, 'utf8');

    assert.throws(
      () => runOperatingAssetGenerator({ argv: ['--check'], projectRoot }),
      (error) =>
        error instanceof OperatingAssetGenerationError &&
        error.code === 'E_OPERATING_ASSET_DRIFT' &&
        error.details.staleTargets.includes(drifted),
      'drift check exits non-zero and names the edited lens agent',
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('every lens generates a native agent (mandate dispatch is the only mode)', () => {
  const roles = readRoles();
  const assets = renderOperatingLensAgentAssets(roles);
  assert.equal(Object.keys(assets).length, MISSION_ROLE_IDS.length);
  for (const id of MISSION_ROLE_IDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(assets, `agents/operating/${id}.md`),
      `${id} generates a native agent`,
    );
  }

  const docs = renderOperatingLensAgentDocs(roles);
  for (const id of MISSION_ROLE_IDS) {
    assert.match(docs, new RegExp(`agents/operating/${id.replaceAll('-', '\\-')}\\.md`));
  }
  assert.doesNotMatch(docs, /pack-mode/u, 'no pack-mode row survives');

  // A resurrected dispatchMode field is rejected by the v1.3 role-registry
  // contract — mandate dispatch is the only mode, so the selector cannot return.
  const withDispatchMode = readRoles();
  withDispatchMode.roles[0].dispatchMode = 'mission';
  assert.throws(
    () => renderOperatingLensAgentAssets(withDispatchMode),
    /operating-role-registry/u,
    'a resurrected dispatchMode field is rejected',
  );
});
