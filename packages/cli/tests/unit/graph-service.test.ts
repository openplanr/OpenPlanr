import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/services/config-service.js';
import {
  classifyGraphStatus,
  readGraph,
  readPlanningModel,
  readProjectGraph,
} from '../../src/services/graph-service.js';

const fixtureRoot = resolve('tests/fixtures/graph-project');
const planrDir = join(fixtureRoot, '.planr');

describe('graph-service', () => {
  it('discovers slug-named artifacts by frontmatter identity in canonical locations', () => {
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
      expect(model.graph.nodes.map((node) => node.id).sort()).toEqual([
        'QT-001',
        'SPEC-001',
        'SPEC-001/T-002',
        'SPEC-001/US-001',
        'T-001',
      ]);
      expect(
        readGraph(root, { includeBody: true }).nodes.find((node) => node.id === 'QT-001'),
      ).toMatchObject({ type: 'quick', title: 'Login artifact', body: '# Login\n' });
      expect(model.references.find((reference) => reference.nodeId === 'QT-001')?.sourcePath).toBe(
        'quick/fix-login.md',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('classifies statuses with the protocol graph status set', () => {
    expect(classifyGraphStatus('done')).toBe('done');
    expect(classifyGraphStatus('closed')).toBe('done');
    expect(classifyGraphStatus('in_progress')).toBe('in-progress');
    expect(classifyGraphStatus('blocked')).toBe('blocked');
    expect(classifyGraphStatus('promoted')).toBe('addressed');
    expect(classifyGraphStatus('accepted')).toBe('outstanding');
  });

  it('builds a schema-shaped graph from canonical artifact files', () => {
    const graph = readGraph(planrDir);
    const ids = graph.nodes.map((node) => node.id).sort();
    const edges = graph.edges.map((edge) => `${edge.kind} ${edge.from} ${edge.to}`).sort();

    expect(ids).toEqual([
      'BL-001',
      'SPEC-001',
      'SPEC-001/T-001',
      'SPEC-001/T-002',
      'SPEC-001/US-001',
    ]);
    expect(edges).toEqual([
      'contains SPEC-001 SPEC-001/T-001',
      'contains SPEC-001 SPEC-001/T-002',
      'contains SPEC-001 SPEC-001/US-001',
      'contains SPEC-001/US-001 SPEC-001/T-001',
      'contains SPEC-001/US-001 SPEC-001/T-002',
      'depends_on SPEC-001/T-002 SPEC-001/T-001',
    ]);

    const task = graph.nodes.find((node) => node.id === 'SPEC-001/T-002');
    expect(task?.githubIssue).toBe(42);
    expect(task?.linearIssueIdentifier).toBe('ENG-99');
    expect(task?.frontmatter.id).toBe('T-002');
    expect(task?.frontmatter.specScope).toBe('SPEC-001');
  });

  it('reads a project graph from projectDir plus config', () => {
    const config = createDefaultConfig('graph-fixture');
    const graph = readProjectGraph(fixtureRoot, config);

    expect(graph.nodes.some((node) => node.id === 'SPEC-001')).toBe(true);
  });
});
