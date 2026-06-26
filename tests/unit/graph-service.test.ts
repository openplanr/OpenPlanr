import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../src/services/config-service.js';
import {
  classifyGraphStatus,
  readGraph,
  readProjectGraph,
} from '../../src/services/graph-service.js';

const fixtureRoot = resolve('tests/fixtures/graph-project');
const planrDir = join(fixtureRoot, '.planr');

describe('graph-service', () => {
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
