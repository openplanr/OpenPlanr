import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveOperateExperienceSearchDestination } from '../../lib/dashboard/operate-experience-reader.mjs';
import { parseOperateApiRoute } from '../../lib/dashboard/server.mjs';

const view = Object.freeze({
  cycles: Object.freeze([Object.freeze({ cycleId: 'cycle-1' })]),
  actions: Object.freeze([Object.freeze({ actionId: 'act_00000001' })]),
  evidence: Object.freeze([Object.freeze({ evidenceRefId: 'evidence-available' })]),
  claims: Object.freeze([]),
  rationale: Object.freeze([]),
  outcomes: Object.freeze([Object.freeze({ outcomeId: 'outcome-1' })]),
});

test('closed Operate API grammar rejects encoding, traversal, and unknown surfaces', () => {
  assert.deepEqual(parseOperateApiRoute('/api/operate/search'), {
    surface: 'search',
    subjectId: null,
  });
  assert.deepEqual(parseOperateApiRoute('/api/operate/evidence'), {
    surface: 'evidence',
    subjectId: null,
  });
  assert.deepEqual(parseOperateApiRoute('/api/operate/cycles/cycle-1'), {
    surface: 'cycle',
    subjectId: 'cycle-1',
  });
  assert.deepEqual(parseOperateApiRoute('/api/operate/cycles/cycle-1/executive-board'), {
    surface: 'cycle-executive-board',
    subjectId: 'cycle-1',
  });
  assert.deepEqual(parseOperateApiRoute('/api/operate/actions'), {
    surface: 'actions',
    subjectId: null,
  });
  assert.deepEqual(parseOperateApiRoute('/api/operate/actions/act_00000001'), {
    surface: 'action',
    subjectId: 'act_00000001',
  });
  assert.deepEqual(
    parseOperateApiRoute('/api/operate/inbox/verification%3Aasg_00000001'),
    { surface: 'inbox', subjectId: 'verification:asg_00000001' },
  );
  assert.deepEqual(parseOperateApiRoute('/api/operate/recovery'), {
    surface: 'recovery',
    subjectId: null,
  });
  for (const pathname of [
    '/api/operate/cycles/a%2Fb',
    '/api/operate/cycles/a%2Fb/executive-board',
    '/api/operate/cycles/%2e%2e',
    '/api/operate/evidence/%2e',
    '/api/operate/inbox/verification%2Fasg_00000001',
    '/api/operate/inbox/verification%5Casg_00000001',
    '/api/operate/inbox/verification%00asg_00000001',
    '/api/operate/inbox/verification%3Aasg_00000001/extra',
    '/api/operate/today/',
    '/api/operate//search',
    '/api/operate/%74oday',
    '/api/operate/unknown',
    '/api/operate/history/event-1',
  ]) {
    assert.equal(parseOperateApiRoute(pathname), null, pathname);
  }
});

test('search destinations reject encoded ownership tricks and keep exact owned routes', () => {
  assert.deepEqual(
    resolveOperateExperienceSearchDestination(view, '#/operate/cycles/cycle-1'),
    { route: 'cycles', surface: 'cycle', subjectId: 'cycle-1' },
  );
  assert.deepEqual(
    resolveOperateExperienceSearchDestination(view, '#/operate/evidence/evidence-available'),
    { route: 'evidence', surface: 'evidence', subjectId: 'evidence-available' },
  );
  for (const href of [
    '#/operate/cycles/a%2Fb',
    '#/operate/cycles/a%5Cb',
    '#/operate/today?actor=foreign',
    '#/operate/history/event-1',
    '#/operate/evidence/private-unknown',
    '#/operate/outcomes/missing',
    '#/operate/actions/act_missing',
  ]) {
    assert.equal(resolveOperateExperienceSearchDestination(view, href), null, href);
  }
});
