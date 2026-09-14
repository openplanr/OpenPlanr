import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readGraph } from '../../lib/dashboard/graph-reader.mjs';

test('sprint graph projection preserves authored delivery metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-pipeline-sprint-'));
  const sprintDir = join(root, 'sprints');
  mkdirSync(sprintDir, { recursive: true });
  writeFileSync(
    join(sprintDir, 'SPRINT-041-crm-recovery.md'),
    [
      '---',
      'id: "SPRINT-041"',
      'name: "CRM recovery and observability"',
      'status: "active"',
      'taskIds: ["QT-071", "T-072"]',
      '---',
      '',
      '# Sprint 41',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const graph = readGraph(root);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].title, 'CRM recovery and observability');
    assert.equal(graph.nodes[0].status, 'in-progress');
    assert.deepStrictEqual(graph.nodes[0].frontmatter.taskIds, ['QT-071', 'T-072']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
