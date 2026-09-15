import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { isLikelyLinearIssueId, reconcileStatus, runPortableSync } from '../src/index.mjs';

test('reconcileStatus applies deterministic three-way conflict rules', () => {
  assert.deepEqual(reconcileStatus({ base: 'todo', local: 'todo', remote: 'done' }, 'local'), {
    final: 'done',
    side: 'remote',
    conflictDecisions: 0,
    isTrueConflict: false,
  });
  assert.equal(reconcileStatus({ local: 'todo', remote: 'done' }, 'local').final, 'todo');
  assert.equal(reconcileStatus({ local: 'todo', remote: 'done' }, 'remote').final, 'done');
});

test('Linear identifiers accept API UUIDs and human identifiers', () => {
  assert.equal(isLikelyLinearIssueId('ENG-42'), true);
  assert.equal(isLikelyLinearIssueId('7c252d85-2db6-4d36-a0ab-3df9f84f0301'), true);
  assert.equal(isLikelyLinearIssueId('ENG42'), false);
});

test('portable helper previews GitHub synchronization without credentials or network', async () => {
  const stdout = new PassThrough();
  let rendered = '';
  stdout.on('data', (chunk) => { rendered += chunk; });
  const stdin = PassThrough.from([JSON.stringify([{ action: 'create', title: 'Example' }])]);
  const result = await runPortableSync(['github', 'sync'], { stdin, stdout });
  assert.equal(result.applied, false);
  assert.match(rendered, /"provider": "github"/u);
});
