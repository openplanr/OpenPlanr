import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('root utility command boundary', () => {
  it('registers only classified deterministic roots through five command groups', () => {
    const commandRoot = resolve('src/cli/commands');
    const facade = readFileSync(resolve(commandRoot, 'index.ts'), 'utf8');
    const groups = readdirSync(resolve(commandRoot, 'groups'))
      .filter((path) => path.endsWith('.ts'))
      .sort();
    expect(groups).toEqual([
      'delivery.ts',
      'foundation.ts',
      'intelligence.ts',
      'operations.ts',
      'planning.ts',
    ]);
    for (const group of ['Delivery', 'Foundation', 'Intelligence', 'Operations', 'Planning']) {
      expect(facade).toContain(`register${group}Commands`);
    }

    const groupSource = groups
      .map((path) => readFileSync(resolve(commandRoot, 'groups', path), 'utf8'))
      .join('\n');
    for (const retired of ['plan', 'pipeline', 'estimate', 'refine', 'revise', 'evidence']) {
      expect(groupSource).not.toContain(`from '../${retired}.js'`);
    }

    const catalog = JSON.parse(
      readFileSync(resolve('../../docs/generated/utility-command-catalog.json'), 'utf8'),
    );
    const activeRoots = new Set(
      catalog.active.map((row: { path: string }) => row.path.split(' ')[0]),
    );
    expect(activeRoots.size).toBe(35);
    expect(activeRoots.has('company')).toBe(true);
    expect(activeRoots.has('dashboard')).toBe(true);
    expect(activeRoots.has('operate')).toBe(true);
    expect(activeRoots.has('sync')).toBe(true);
    expect(activeRoots.has('plan')).toBe(false);
    expect(catalog.retired).toContainEqual({
      path: 'spec decompose',
      classification: 'semantic-moved-to-skill',
    });
  });
});
