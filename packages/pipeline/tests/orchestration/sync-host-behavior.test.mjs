import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

// SPEC-007's one-time extraction accounting belonged to the retired command
// router. Keep the legacy procedure guardrails and verify the active package's
// authorization guidance and executable preview behavior instead of historical
// line equality. Integrations' portable-sync/linear-failure-paths suites own
// conflict resolution and provider mutation responses.
test('the retained legacy procedure keeps its branch and outward-action guardrails', () => {
  const procedure = read('packages/pipeline/procedures/sync-workflow.md');
  assert.match(procedure, /Operate on the canonical branch/);
  assert.match(procedure, /Outward-action gate/);
  assert.match(procedure, /"Done" is evidenced, never assumed/);
  assert.match(procedure, /## HARD RULES/);
  assert.match(procedure, /## Steps/);
  assert.match(procedure, /## Termination/);
});

const surfaces = [
  ['canonical', 'skills/planr-sync/SKILL.md', 'skills/planr-sync/scripts/sync.mjs'],
  ['openai', 'dist/plugins/openai/openplanr/skills/sync/SKILL.md', 'dist/plugins/openai/openplanr/skills/sync/scripts/sync.mjs'],
  ['claude', 'dist/plugins/claude/openplanr/skills/sync/SKILL.md', 'dist/plugins/claude/openplanr/skills/sync/scripts/sync.mjs'],
  ['cursor', 'dist/plugins/cursor/openplanr/rules/planr-sync.mdc', 'dist/plugins/cursor/openplanr/rules/planr-sync/scripts/sync.mjs'],
];

for (const [surface, entrypoint, helper] of surfaces) {
  test(`${surface}: sync guidance scopes local and remote changes to the request`, () => {
    const guidance = read(entrypoint);
    assert.match(guidance, /Audit is read-only by default/);
    assert.match(guidance, /Apply local changes only when the request asks for\s+reconciliation/);
    assert.match(guidance, /push remote changes only when the request asks for external\s+synchronization/);
    assert.match(guidance, /If credentials are unavailable, complete local reconciliation\s+and report only the external step that could not run/);
    assert.match(guidance, /Return aligned, locally repairable, conflict, and unavailable counts/);
    assert.match(guidance, /OpenPlanr CLI is never required/);
    assert.doesNotMatch(guidance, /procedures\/sync-workflow\.md|commands\/sync\.md/);
  });

  for (const provider of ['github', 'linear']) {
    test(`${surface}: ${provider} synchronization previews without credentials or installed tools`, (t) => {
      const project = mkdtempSync(join(tmpdir(), 'openplanr-sync-preview-'));
      t.after(() => rmSync(project, { recursive: true, force: true }));
      const operations = [{ action: 'create', title: 'Preview only', teamId: 'fixture-team' }];
      const result = spawnSync(process.execPath, [join(root, helper), provider, 'sync'], {
        cwd: project,
        encoding: 'utf8',
        input: JSON.stringify(operations),
        // A regression cannot reach installed tools or inherit provider secrets.
        env: { PATH: '', PLANR_LINEAR_TOKEN: '' },
        timeout: 5_000,
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      assert.deepEqual(JSON.parse(result.stdout), { provider, applied: false, operations });
      assert.deepEqual(readdirSync(project), [], 'preview must not write project files');
    });
  }
}
