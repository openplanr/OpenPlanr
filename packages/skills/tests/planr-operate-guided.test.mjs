import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skill = readFileSync(join(root, 'skills', 'planr-operate', 'SKILL.md'), 'utf8');
const ecosystemRoot = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(root, '..'));

const fixtures = [
  {
    name: 'one missing answer',
    result: {
      ok: false,
      action: 'input_required',
      code: 'E_OPERATE_INPUT_REQUIRED',
      questionnaire: { sessionId: 'GIS-one', questions: [{ questionId: 'owner', type: 'text' }] },
    },
    expected: 'present-questionnaire',
  },
  {
    name: 'multi-stage answer',
    result: {
      ok: false,
      action: 'input_required',
      questionnaire: { sessionId: 'GIS-two', stage: 'product-charter', questions: [] },
    },
    expected: 'resume-session',
  },
  {
    name: 'cancellation',
    result: { ok: false, code: 'E_OPERATE_SESSION_CANCELLED', actions: [] },
    expected: 'stop',
  },
  {
    name: 'stale session',
    result: { ok: false, code: 'E_OPERATE_SESSION_STALE', actions: [] },
    expected: 'stop',
  },
  {
    name: 'safe evidence failure',
    result: {
      ok: false,
      code: 'E_OPERATE_SECRET_DETECTED',
      nextActions: ['planr operate evidence diagnose EVC-safe --json'],
    },
    expected: 'diagnose',
  },
  ...[
    'operate.init.apply',
    'operate.run.start',
    'operate.provider.call',
    'operate.routes.apply',
    'operate.plan.handoff',
    'operate.ship.handoff',
  ].map((id) => ({
    name: `confirmation scope ${id}`,
    result: {
      ok: true,
      actions: [
        {
          id,
          effect: 'project-write',
          requiresConfirmation: true,
          confirmationDigest: `sha256:${'a'.repeat(64)}`,
        },
      ],
    },
    expected: 'stop-for-confirmation',
  })),
];

test('the standalone skill remains byte-identical to the canonical generated Codex asset', () => {
  const canonical = readFileSync(
    resolve(
      ecosystemRoot,
      'planr-pipeline',
      'adapters',
      'codex',
      'skills',
      'planr-operate',
      'SKILL.md',
    ),
    'utf8',
  );
  assert.equal(skill, canonical);
});

test('guided conversation fixtures preserve every stop boundary', () => {
  for (const fixture of fixtures) {
    if (fixture.result.action === 'input_required') {
      assert.match(skill, /Present questions verbatim/);
      assert.match(skill, /bounded stdin\/resume lifecycle/);
    }
    if (fixture.result.code === 'E_OPERATE_SECRET_DETECTED') {
      assert.match(skill, /planr operate evidence diagnose/);
      assert.match(skill, /Never trial-edit sources/);
    }
    if (fixture.result.actions?.some((action) => action.requiresConfirmation)) {
      assert.match(skill, /Stop after each selected non-read-only action/);
      assert.match(skill, /Never add `--yes`/);
    }
    assert.ok(fixture.expected, fixture.name);
  }
});

test('the skill contains no copied question/default logic or unsafe command routing', () => {
  assert.doesNotMatch(skill, /Who owns final operating decisions\?/);
  assert.doesNotMatch(skill, /Operating profile:/);
  assert.doesNotMatch(skill, /(?:^|\n)\s*(?:sed|perl|python|node)\s+.*\.planr\/operate/m);
  assert.doesNotMatch(skill, /`planr operate[^`]*--yes[^`]*`/);
  assert.doesNotMatch(skill, /(?:^|\n)\s*planr-pipeline\s+/m);
});
