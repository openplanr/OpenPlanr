import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

// The one-time extraction accounting belonged to the retired command
// router. Keep the legacy procedure guardrails and verify the active package's
// authorization guidance and executable preview behavior instead of historical
// line equality. The integrations suites and the CLI's sync-tracker tests own
// conflict resolution, GitHub mutation responses and Linear routing.
test('the retained legacy procedure keeps its branch and outward-action guardrails', () => {
  const procedure = read('packages/pipeline/procedures/sync-workflow.md');
  assert.match(procedure, /Operate on the canonical branch/);
  assert.match(procedure, /Outward-action gate/);
  assert.match(procedure, /"Done" is evidenced, never assumed/);
  assert.match(procedure, /## HARD RULES/);
  assert.match(procedure, /## Steps/);
  assert.match(procedure, /## Termination/);
});

// Each surface's skill entrypoint and the directory its references sit in.
const surfaces = [
  ['canonical', 'skills/planr-sync/SKILL.md', 'skills/planr-sync'],
  [
    'openai',
    'dist/plugins/openai/openplanr/skills/sync/SKILL.md',
    'dist/plugins/openai/openplanr/skills/sync',
  ],
  [
    'claude',
    'dist/plugins/claude/openplanr/skills/sync/SKILL.md',
    'dist/plugins/claude/openplanr/skills/sync',
  ],
  [
    'cursor',
    'dist/plugins/cursor/openplanr/rules/planr-sync.mdc',
    'dist/plugins/cursor/openplanr/rules/planr-sync',
  ],
];

for (const [surface, entrypoint, skillRoot] of surfaces) {
  test(`${surface}: sync guidance scopes local and remote changes to the request`, () => {
    const guidance = read(entrypoint);
    assert.match(guidance, /Audit is read-only by default/);
    assert.match(guidance, /Apply local changes only when the request asks for\s+reconciliation/);
    assert.match(
      guidance,
      /push remote changes only when the request asks for external\s+synchronization/,
    );
    assert.match(
      guidance,
      /If a connection is unavailable, complete local reconciliation\s+and report only the external step that could not run/,
    );
    assert.match(
      guidance.replace(/\s+/gu, ' '),
      /Summarize aligned, locally repairable, conflict and unavailable counts/u,
    );
    assert.match(
      guidance.replace(/\s+/gu, ' '),
      /Local work and tracker work through the host's connection never require the OpenPlanr CLI/u,
    );
    assert.match(guidance, /Remote steps run through the host's own ~~project tracker connection/);
    assert.doesNotMatch(guidance, /planr linear|access\s+token|PLANR_LINEAR_TOKEN/u);
    assert.doesNotMatch(guidance, /procedures\/sync-workflow\.md|commands\/sync\.md/);
  });

  test(`${surface}: the sync reference uses host connections and the catalog names each host`, () => {
    const guide = read(`${skillRoot}/references/tracker-connections.md`);
    assert.match(guide, /These skills store and read no tracker or source control credentials/);
    assert.match(guide, /\*\*Linear:\*\* the host's Linear connection/);
    assert.doesNotMatch(guide, /Bearer|Authorization|_TOKEN|personal access token/iu);
    const connectors = read(`${skillRoot}/references/connectors.md`);
    for (const host of ['Claude Code', 'Codex', 'Cursor'])
      assert.match(connectors, new RegExp(host));
    assert.doesNotMatch(connectors, /Bearer|Authorization|_TOKEN/u);
  });

  test(`${surface}: tracker writes go through the host's connection and the skill ships no script`, () => {
    const guidance = read(entrypoint).replace(/\s+/gu, ' ');
    assert.match(guidance, /Every tracker syncs only through the host's connection/u);
    assert.doesNotMatch(guidance, /sync tracker github|GitHub CLI|gh CLI/u);
    assert.equal(existsSync(join(root, skillRoot, 'references/openplanr-cli.md')), false);
    assert.equal(existsSync(join(root, skillRoot, 'scripts')), false);
  });
}

const previewRule =
  /Before any remote write, list every issue change: each issue to create, update, close or reopen, with its title and the status it moves to\. Write only when the request explicitly asked for that push or the user approves the list\. Afterwards, report each item that was not updated and why/u;
const flat = (path) => read(path).replace(/\s+/gu, ' ');

for (const skill of ['planr-status', 'planr-sprint', 'planr-sync']) {
  test(`${skill}: works with nothing connected and names the category it would use`, () => {
    const guidance = flat(`skills/${skill}/SKILL.md`);
    assert.match(guidance, /With nothing connected/u);
    assert.match(guidance, /not run/u);
    assert.match(
      guidance,
      /give the current host's step from \[connectors\]\(references\/connectors\.md\)/u,
    );
    assert.match(guidance, /~~project tracker/u);
  });
}

for (const skill of ['planr-sprint', 'planr-sync']) {
  test(`${skill}: previews every issue change before a tracker write`, () => {
    const guidance = flat(`skills/${skill}/SKILL.md`);
    assert.match(guidance, previewRule);
    assert.match(guidance, /name the category and product/u);
  });
}

test('planr-status reads remote state only on request and never writes to a remote service', () => {
  const guidance = flat('skills/planr-status/SKILL.md');
  assert.match(guidance, /Add remote lookups only when the user requests live remote state/u);
  assert.match(guidance, /Status never writes to a remote service/u);
  assert.match(guidance, /Name the category each remote fact came from/u);
});
