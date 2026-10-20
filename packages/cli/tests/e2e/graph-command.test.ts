import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const fixtureRoot = resolve('tests/fixtures/graph-project');

describe('openplanr graph', () => {
  it('emits stable graph JSON', () => {
    const output = execFileSync(
      process.execPath,
      [TSX, CLI, '--project-dir', fixtureRoot, 'graph', '--json'],
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
  });

  it('reports each duplicate id on stderr and keeps the JSON and exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'planr-graph-command-'));
    try {
      cpSync(fixtureRoot, root, { recursive: true });
      writeFileSync(
        join(root, '.planr/specs/SPEC-001-checkout/AAA-copy.md'),
        '---\nid: SPEC-001\ntitle: Copy\n---\n# Copy\n',
      );
      const result = spawnSync(
        process.execPath,
        [TSX, CLI, '--project-dir', root, 'graph', '--json'],
        { encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe(
        'Duplicate id SPEC-001: kept specs/SPEC-001-checkout/SPEC-001-checkout.md, skipped specs/SPEC-001-checkout/AAA-copy.md\n',
      );
      const graph = JSON.parse(result.stdout);
      expect(Object.keys(graph)).toEqual(['nodes', 'edges']);
      expect(graph.nodes.filter((node: { id: string }) => node.id === 'SPEC-001')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
