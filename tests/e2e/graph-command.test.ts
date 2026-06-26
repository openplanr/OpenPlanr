import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const fixtureRoot = resolve('tests/fixtures/graph-project');

describe('planr graph', () => {
  it('emits stable graph JSON', () => {
    const output = execFileSync(
      'npx',
      ['tsx', CLI, '--project-dir', fixtureRoot, 'graph', '--json'],
      {
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
    const graph = JSON.parse(output);

    expect(graph).toHaveProperty('nodes');
    expect(graph).toHaveProperty('edges');
    expect(graph.nodes.map((node: { id: string }) => node.id).sort()).toEqual([
      'BL-001',
      'SPEC-001',
      'SPEC-001/T-001',
      'SPEC-001/T-002',
      'SPEC-001/US-001',
    ]);
    expect(graph.edges).toContainEqual({
      from: 'SPEC-001/T-002',
      to: 'SPEC-001/T-001',
      kind: 'depends_on',
    });
  }, 20_000);
});
