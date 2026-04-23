import { describe, expect, it } from 'vitest';
import type { ParsedSubtask } from '../src/agents/task-parser.js';
import {
  applyCheckboxMergeToLocalBody,
  buildNameToBacklogStatusMap,
  buildNameToStatusMap,
  extractTaskSectionFromMergedDescription,
  mapLinearNameToBacklogStatus,
  mapLinearNameToTaskStatus,
  mergeByIdForFormat,
  replaceTaskSectionInMergedDescription,
  resolveTaskCheckboxFinalStates,
} from '../src/services/linear-pull-service.js';
import { isLikelyLinearWorkflowStateId } from '../src/services/linear-service.js';

describe('linear-pull-service status map (formerly linear-status-sync-service)', () => {
  it('mapLinearNameToTaskStatus uses defaults and case', () => {
    const m = buildNameToStatusMap(undefined);
    expect(mapLinearNameToTaskStatus('In Progress', m)).toBe('in-progress');
    expect(mapLinearNameToTaskStatus('TODO', m)).toBe('pending');
    expect(mapLinearNameToTaskStatus('done', m)).toBe('done');
  });

  it('user statusMap overrides defaults', () => {
    const m = buildNameToStatusMap({ 'Code Review': 'in-progress' });
    expect(mapLinearNameToTaskStatus('Code Review', m)).toBe('in-progress');
  });

  it('ignores uuid-shaped values in user statusMap', () => {
    const m = buildNameToStatusMap({
      'Custom Lane': '8c4d4c4e-0e0e-4c4c-8c4c-4c4c4c4c4c4c',
    });
    expect(mapLinearNameToTaskStatus('Custom Lane', m)).toBeUndefined();
    expect(isLikelyLinearWorkflowStateId('8c4d4c4e-0e0e-4c4c-8c4c-4c4c4c4c4c4c')).toBe(true);
  });

  it('returns undefined for unknown state names', () => {
    const m = buildNameToStatusMap(undefined);
    expect(mapLinearNameToTaskStatus('Lunar Phase Gate', m)).toBeUndefined();
  });
});

const t0 = (
  id: string,
  title: string,
  done: boolean,
  depth: 0 | 1,
  parent: string | null,
): ParsedSubtask => ({
  id,
  title,
  done,
  parentId: parent,
  depth,
});

describe('extractTaskSectionFromMergedDescription', () => {
  it('uses full body for a single owning task file with no h2s', () => {
    const b = 'Intro\n\n- [ ] **1.0** A';
    expect(extractTaskSectionFromMergedDescription(b, 'TASK-10', 1)).toBe(
      'Intro\n\n- [ ] **1.0** A',
    );
  });

  it('extracts a section when the issue has multiple h2s', () => {
    const b = '## TASK-1\n\n- [x] **1.0** A\n\n## TASK-2\n\n- [ ] **2.0** B';
    expect(extractTaskSectionFromMergedDescription(b, 'TASK-1', 2)).toBe('- [x] **1.0** A');
    expect(extractTaskSectionFromMergedDescription(b, 'TASK-2', 2)).toBe('- [ ] **2.0** B');
  });

  it('returns empty for a missing section when several files map to the same issue', () => {
    const b = '## TASK-1\n\n- [x] **1.0** A';
    expect(extractTaskSectionFromMergedDescription(b, 'TASK-2', 2)).toBe('');
  });
});

describe('replaceTaskSectionInMergedDescription', () => {
  it('replaces one section in a multi-section body', () => {
    const b = '## TASK-1\n\n- [ ] **1.0** A\n\n## TASK-2\n\n- [ ] **2.0** B';
    const out = replaceTaskSectionInMergedDescription(b, 'TASK-1', '- [x] **1.0** A');
    expect(out).toContain('## TASK-1');
    expect(out).toMatch(/- \[x\] \*\*1\.0\*\* A/);
    expect(out).toContain('## TASK-2');
  });
});

describe('mergeByIdForFormat', () => {
  it('keeps local order, then appends remote-only', () => {
    const local: ParsedSubtask[] = [t0('1.0', 'G', true, 0, null), t0('1.1', 'S', false, 1, '1.0')];
    const remote: ParsedSubtask[] = [t0('2.0', 'R', false, 0, null)];
    const final = new Map<string, boolean>([
      ['1.0', true],
      ['1.1', true],
      ['2.0', false],
    ]);
    const m = mergeByIdForFormat(local, remote, final);
    expect(m.map((x) => x.id)).toEqual(['1.0', '1.1', '2.0']);
  });
});

describe('resolveTaskCheckboxFinalStates', () => {
  it('favors remote when local matched base and remote changed', async () => {
    const { final, conflictDecisions } = await resolveTaskCheckboxFinalStates(
      new Map([['1.0', true]]),
      new Map([['1.0', false]]),
      new Map([['1.0', true]]),
      'local',
      'x',
    );
    expect(final.get('1.0')).toBe(false);
    expect(conflictDecisions).toBe(0);
  });

  it('flags a conflict and honors strategy local', async () => {
    const { final, conflictDecisions } = await resolveTaskCheckboxFinalStates(
      new Map([['1.0', true]]),
      new Map([['1.0', false]]),
      new Map(),
      'local',
      'x',
    );
    expect(final.get('1.0')).toBe(true);
    expect(conflictDecisions).toBe(1);
  });
});

describe('applyCheckboxMergeToLocalBody', () => {
  it('applies state map, removes absent ids, and appends new tasks', () => {
    const body = '- [ ] **1.0** G\n  - [ ] 1.1 S';
    const final = new Map<string, boolean>([
      ['1.0', true],
      ['1.1', false],
      ['2.0', true],
    ]);
    const rebuilt: ParsedSubtask[] = [
      t0('1.0', 'G', true, 0, null),
      t0('1.1', 'S', false, 1, '1.0'),
      t0('2.0', 'N', true, 0, null),
    ];
    const out = applyCheckboxMergeToLocalBody(body, final, rebuilt);
    expect(out).toMatch(/- \[x\].*1\.0/);
    expect(out).toMatch(/- \[ \].*1\.1/);
    expect(out).toMatch(/- \[x\].*2\.0/);
  });
});

describe('linear-pull-service backlog status map', () => {
  it('maps Linear "in flight" states to open (not in-progress)', () => {
    const m = buildNameToBacklogStatusMap(undefined);
    expect(mapLinearNameToBacklogStatus('Todo', m)).toBe('open');
    expect(mapLinearNameToBacklogStatus('In Progress', m)).toBe('open');
    expect(mapLinearNameToBacklogStatus('In Review', m)).toBe('open');
    expect(mapLinearNameToBacklogStatus('Backlog', m)).toBe('open');
  });

  it('maps Done and Canceled to closed', () => {
    const m = buildNameToBacklogStatusMap(undefined);
    expect(mapLinearNameToBacklogStatus('Done', m)).toBe('closed');
    expect(mapLinearNameToBacklogStatus('Completed', m)).toBe('closed');
    expect(mapLinearNameToBacklogStatus('Cancelled', m)).toBe('closed');
    expect(mapLinearNameToBacklogStatus('Canceled', m)).toBe('closed');
  });

  it('user statusMap can override defaults with backlog vocabulary', () => {
    const m = buildNameToBacklogStatusMap({ 'Ready For Pickup': 'open', Archived: 'closed' });
    expect(mapLinearNameToBacklogStatus('Ready For Pickup', m)).toBe('open');
    expect(mapLinearNameToBacklogStatus('Archived', m)).toBe('closed');
  });

  it('ignores user statusMap values that are task vocabulary (pending/in-progress/done)', () => {
    // Task vocabulary doesn't belong in a backlog map — filtered out so the
    // default `Todo → open` still wins instead of `Todo → pending`.
    const m = buildNameToBacklogStatusMap({ Todo: 'pending' });
    expect(mapLinearNameToBacklogStatus('Todo', m)).toBe('open');
  });

  it('ignores uuid-shaped values', () => {
    const m = buildNameToBacklogStatusMap({
      'Custom Lane': '8c4d4c4e-0e0e-4c4c-8c4c-4c4c4c4c4c4c',
    });
    expect(mapLinearNameToBacklogStatus('Custom Lane', m)).toBeUndefined();
  });

  it('returns undefined for unknown state names', () => {
    const m = buildNameToBacklogStatusMap(undefined);
    expect(mapLinearNameToBacklogStatus('Lunar Phase Gate', m)).toBeUndefined();
  });
});
