import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { deriveOperatingViewModel } from '../../lib/dashboard/app/views/operate.js';
import { DASHBOARD_VIEWS } from '../../lib/dashboard/server.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    join(root, 'conformance/fixtures/operating-dashboard/.planr/operate/projections/state.json'),
    'utf8',
  ),
);

test('operating view derives the approved evidence-to-outcome causal thread', () => {
  const model = deriveOperatingViewModel(fixture);
  assert.equal(model.cycle.id, 'CYCLE-001');
  assert.equal(model.finding.id, 'FND-001');
  assert.equal(model.route.id, 'ACT-001');
  assert.equal(model.specLink.specId, 'SPEC-003');
  assert.equal(model.outcome.id, 'OUT-001');
  assert.equal(model.decision.id, 'DEC-001');
  assert.equal(model.gap.id, 'GAP-001');
  assert.equal(model.eventHead.sequence, 17);
  assert.deepEqual(
    model.lenses.map(({ label }) => label),
    ['CEO', 'CTO', 'CPO', 'CMO', 'COO', 'Chair'],
  );
});

test('operating lens readiness is honest when evidence gaps name affected roles', () => {
  const state = structuredClone(fixture);
  state.dataGaps[0].affectedRoles = ['technology-risk'];
  const model = deriveOperatingViewModel(state);
  assert.equal(
    model.lenses.find(({ id }) => id === 'technology-risk').state,
    'needs-evidence',
  );
  assert.equal(model.lenses.find(({ id }) => id === 'strategy-finance').state, 'enabled');
});

test('production dashboard registers a lazy read-only Operating route and stylesheet', () => {
  const main = readFileSync(join(root, 'lib/dashboard/app/main.js'), 'utf8');
  const shell = readFileSync(join(root, 'lib/dashboard/app/shell.js'), 'utf8');
  const view = readFileSync(join(root, 'lib/dashboard/app/views/operate.js'), 'utf8');
  const index = readFileSync(join(root, 'lib/dashboard/app/index.html'), 'utf8');
  const css = readFileSync(join(root, 'lib/dashboard/app/styles/operate.css'), 'utf8');

  assert.ok(DASHBOARD_VIEWS.includes('operate'));
  assert.match(main, /views\/operate\.js/);
  assert.match(shell, /label: 'Operating'/);
  assert.match(index, /styles\/operate\.css/);
  assert.match(view, /planr operate review/);
  assert.doesNotMatch(view, /method:\\s*['"](?:POST|PATCH|PUT|DELETE)/);
  assert.match(css, /\.op-thread/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /var\(--primary\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/);
});
