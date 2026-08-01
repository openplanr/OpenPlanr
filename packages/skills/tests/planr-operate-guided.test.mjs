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
    name: 'citation validation failure',
    result: {
      ok: false,
      code: 'E_OPERATE_CITATION_INVALID',
      handoff: { recovery: ['planr', 'operate', 'adapter', 'resume', '--json'] },
    },
    expected: 'recover-current-handoff',
  },
  {
    name: 'selected native cycle start',
    result: {
      ok: true,
      actions: [{
        id: 'operate.run.start',
        effect: 'project-write',
        requiresConfirmation: true,
        confirmationDigest: `sha256:${'a'.repeat(64)}`,
      }],
    },
    expected: 'continue-native-cycle',
  },
  ...[
    'operate.init.apply',
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

test('Windows checkouts preserve canonical generated-skill bytes', () => {
  const attributes = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^skills\/planr-operate\/SKILL\.md text eol=lf$/m);
});

test('guided conversation fixtures preserve every stop boundary', () => {
  for (const fixture of fixtures) {
    if (fixture.result.action === 'input_required') {
      assert.match(skill, /Present questions verbatim/);
      assert.match(skill, /bounded\s+stdin\/resume lifecycle/);
      assert.match(skill, /submission\.envelope\.fixedFields/);
      assert.match(skill, /answers\.copyFields/);
      assert.match(skill, /required.*valueType.*constraints|constraints.*required.*valueType/s);
      assert.match(skill, /transport\.argv/);
      assert.match(skill, /Do\s+not guess envelope metadata/);
    }
    if (fixture.result.code === 'E_OPERATE_CITATION_INVALID') {
      assert.match(skill, /citation validation rejects a result/);
      assert.match(skill, /current handoff's\s+recovery action/);
      assert.match(skill, /Never trial-edit `\.planr\/operate`/);
    }
    if (fixture.result.actions?.some((action) => action.requiresConfirmation)) {
      if (fixture.expected === 'continue-native-cycle') {
        assert.match(skill, /explicit request to \*\*run one Operating Board cycle\*\*/);
        assert.match(skill, /Do not ask\s+the user to paste or manually rerun/);
        assert.match(skill, /top-level `handoff` as the only lifecycle command/);
        assert.match(skill, /`handoff\.next\[\]\.argv`/);
        assert.match(skill, /`handoff\.recovery` only after a\s+failed current action/);
        assert.match(skill, /role's operating mandate at `dispatch\.mandatePointer`/);
        assert.match(skill, /never\s+probe\s+(?:these\s+)?machine\s+commands\s+with\s+`--help`/);
      } else {
        assert.match(skill, /Ask separately for external provider consent/);
        assert.match(skill, /planning-artifact creation, PLAN, SHIP/);
      }
    }
    assert.ok(fixture.expected, fixture.name);
  }
});

test('bare invocation runs one complete cycle while explicit read-only commands stay scoped', () => {
  assert.match(skill, /## Default workflow/);
  assert.match(skill, /planr operate inspect --json/);
  assert.match(skill, /When `data\.initialized` is `true`, do not reopen initialization/);
  assert.match(skill, /bare skill invocation as the explicit request for one cycle/);
  assert.match(skill, /CEO, CTO,\s+CPO, CMO, COO, and Chair/);
  assert.match(skill, /planr operate report/);
  assert.match(skill, /perform only that command/);
});

test('the skill contains no copied question/default logic or unsafe command routing', () => {
  assert.match(
    skill,
    /Start guided setup with exactly `planr operate init --json` only after inspect/,
  );
  assert.match(skill, /structured chat one\s+question at a time/);
  assert.match(skill, /never dump the whole questionnaire as a form/);
  assert.doesNotMatch(skill, /planr operate init --guided/);
  assert.match(skill, /`dispatch\.mandatePointer`/);
  assert.match(skill, /operating-advisor-response@1\.3\.0/);
  assert.doesNotMatch(skill, /rolePackPointer|missionPacketPointer/);
  assert.doesNotMatch(skill, /planr operate evidence (?:diagnose|classify)/);
  assert.doesNotMatch(skill, /planr operate sources test/);
  assert.match(
    skill,
    /Do not add\s+`kind`,\s+cycle,\s+role,\s+input-digest,\s+producer,\s+or\s+result-digest\s+metadata/,
  );
  assert.doesNotMatch(skill, /Who owns final operating decisions\?/);
  assert.doesNotMatch(skill, /Operating profile:/);
  assert.doesNotMatch(skill, /(?:^|\n)\s*(?:sed|perl|python|node)\s+.*\.planr\/operate/m);
  assert.doesNotMatch(skill, /(?:^|\n)\s*planr operate[^\n]*--yes/m);
  assert.doesNotMatch(skill, /(?:^|\n)\s*planr-pipeline\s+/m);
});
