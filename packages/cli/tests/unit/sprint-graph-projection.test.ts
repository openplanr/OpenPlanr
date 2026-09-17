import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGraph } from '../../src/services/graph-service.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('sprint graph projection', () => {
  it('preserves authored sprint names, active state, and commitment ids', () => {
    const root = mkdtempSync(join(tmpdir(), 'openplanr-cli-sprint-'));
    temporaryRoots.push(root);
    const sprintDir = join(root, 'sprints');
    mkdirSync(sprintDir, { recursive: true });
    writeFileSync(
      join(sprintDir, 'SPRINT-041-crm-recovery.md'),
      [
        '---',
        'id: "SPRINT-041"',
        'name: "CRM recovery and observability"',
        'status: "active"',
        'taskIds: ["QT-071"]',
        '---',
      ].join('\n'),
      'utf8',
    );

    const sprint = readGraph(root).nodes[0];
    expect(sprint).toMatchObject({
      id: 'SPRINT-041',
      title: 'CRM recovery and observability',
      status: 'in-progress',
    });
    expect(sprint?.frontmatter.taskIds).toEqual(['QT-071']);
  });

  it('ignores refinement notes stored under sprints/SPRINT-NNN/', () => {
    const root = mkdtempSync(join(tmpdir(), 'openplanr-cli-sprint-'));
    temporaryRoots.push(root);
    const sprintDir = join(root, 'sprints');
    mkdirSync(join(sprintDir, 'SPRINT-041'), { recursive: true });
    writeFileSync(
      join(sprintDir, 'SPRINT-041-crm-recovery.md'),
      ['---', 'id: "SPRINT-041"', 'name: "CRM recovery"', 'status: "active"', '---'].join('\n'),
      'utf8',
    );
    writeFileSync(
      join(sprintDir, 'SPRINT-041', 'refinement.md'),
      '# SPRINT-041 refinement\n',
      'utf8',
    );
    writeFileSync(join(sprintDir, 'SPRINT-041', 'refinement.json'), '{}\n', 'utf8');

    expect(readGraph(root).nodes.map((node) => node.id)).toEqual(['SPRINT-041']);
  });
});
