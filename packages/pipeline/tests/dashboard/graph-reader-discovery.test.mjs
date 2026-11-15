import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  findPlanningArtifactSource,
  readGraph,
  readPlanningModel,
} from '../../lib/dashboard/graph-reader.mjs';

test('discovers slug-named artifacts by frontmatter identity in canonical locations', () => {
  const root = mkdtempSync(join(tmpdir(), 'planr-graph-discovery-'));
  try {
    const sources = {
      'quick/fix-login.md': 'QT-001',
      'tasks/us-login/validate-session.md': 'T-001',
      'specs/SPEC-001-login/login.md': 'SPEC-001',
      'specs/SPEC-001-login/stories/sign-in.md': 'US-001',
      'specs/SPEC-001-login/tasks/check-token.md': 'T-002',
      'quick/README.md': 'not-an-artifact',
      'quick/missing-identity.md': '',
      'quick/.hidden.md': 'QT-002',
      'quick/login-error-report.md': 'QT-003',
      'quick/.private/hidden.md': 'QT-004',
      'sprints/SPRINT-001/notes.md': 'QT-005',
      'designs/login.md': 'QT-006',
      'specs/SPEC-001-login/design/login.md': 'QT-007',
      'specs/SPEC-001-login/tasks/README.md': 'not-an-artifact',
    };
    for (const [source, id] of Object.entries(sources)) {
      const file = join(root, source);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        `---\nid: ${id}\ntitle: Login artifact\ndependsOn: [QT-999]\n---\n# Login\n`,
      );
    }
    const model = readPlanningModel(root);
    assert.deepEqual(model.graph.nodes.map((node) => node.id).sort(), [
      'QT-001',
      'SPEC-001',
      'SPEC-001/T-002',
      'SPEC-001/US-001',
      'T-001',
    ]);
    const quick = readGraph(root, { includeBody: true }).nodes.find((node) => node.id === 'QT-001');
    assert.equal(quick.type, 'quick');
    assert.equal(quick.title, 'Login artifact');
    assert.equal(quick.body, '# Login\n');
    assert.equal(
      model.references.find((reference) => reference.nodeId === 'QT-001').sourcePath,
      'quick/fix-login.md',
    );
    assert.equal(findPlanningArtifactSource(root, 'QT-001'), join(root, 'quick/fix-login.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
