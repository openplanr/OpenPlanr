import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  display: {
    separator: vi.fn(),
    heading: vi.fn(),
    line: vi.fn(),
    blank: vi.fn(),
  },
  logger: {
    heading: vi.fn(),
    dim: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('chalk', () => ({
  default: {
    dim: (s: string) => s,
    yellow: (s: string) => s,
    bold: Object.assign((s: string) => s, { cyan: (s: string) => s }),
  },
}));

import type { TaskGroup, TaskPreviewData } from '../../src/cli/helpers/task-creation.js';
import {
  buildTaskItems,
  countTaskItems,
  displayNextSteps,
  displayTaskPreview,
  handleAIError,
} from '../../src/cli/helpers/task-creation.js';
import { display, logger } from '../../src/utils/logger.js';

describe('buildTaskItems', () => {
  it('converts task groups into artifact-ready shape with pending status', () => {
    const tasks: TaskGroup[] = [
      {
        id: 'TASK-001',
        title: 'Setup project',
        subtasks: [
          { id: '1.1', title: 'Init repo' },
          { id: '1.2', title: 'Add dependencies' },
        ],
      },
    ];

    const items = buildTaskItems({ tasks });

    expect(items).toEqual([
      {
        id: 'TASK-001',
        title: 'Setup project',
        status: 'pending',
        subtasks: [
          { id: '1.1', title: 'Init repo', status: 'pending', subtasks: [] },
          { id: '1.2', title: 'Add dependencies', status: 'pending', subtasks: [] },
        ],
      },
    ]);
  });

  it('handles task groups with no subtasks', () => {
    const tasks: TaskGroup[] = [{ id: 'TASK-002', title: 'Standalone task' }];

    const items = buildTaskItems({ tasks });

    expect(items).toEqual([
      {
        id: 'TASK-002',
        title: 'Standalone task',
        status: 'pending',
        subtasks: [],
      },
    ]);
  });

  it('handles multiple task groups', () => {
    const tasks: TaskGroup[] = [
      { id: 'TASK-001', title: 'First', subtasks: [{ id: '1.1', title: 'Sub A' }] },
      { id: 'TASK-002', title: 'Second', subtasks: [{ id: '2.1', title: 'Sub B' }] },
    ];

    const items = buildTaskItems({ tasks });

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('TASK-001');
    expect(items[1].id).toBe('TASK-002');
  });

  it('returns empty array for empty tasks', () => {
    expect(buildTaskItems({ tasks: [] })).toEqual([]);
  });
});

describe('countTaskItems', () => {
  it('counts top-level tasks only when no subtasks', () => {
    const tasks: TaskGroup[] = [
      { id: 'T-001', title: 'A' },
      { id: 'T-002', title: 'B' },
    ];
    expect(countTaskItems(tasks)).toBe(2);
  });

  it('counts top-level tasks plus subtasks', () => {
    const tasks: TaskGroup[] = [
      {
        id: 'T-001',
        title: 'A',
        subtasks: [
          { id: '1.1', title: 'Sub 1' },
          { id: '1.2', title: 'Sub 2' },
        ],
      },
      {
        id: 'T-002',
        title: 'B',
        subtasks: [{ id: '2.1', title: 'Sub 3' }],
      },
    ];
    // 2 top-level + 3 subtasks = 5
    expect(countTaskItems(tasks)).toBe(5);
  });

  it('returns 0 for empty array', () => {
    expect(countTaskItems([])).toBe(0);
  });

  it('handles undefined subtasks', () => {
    const tasks: TaskGroup[] = [{ id: 'T-001', title: 'A' }];
    expect(countTaskItems(tasks)).toBe(1);
  });
});

describe('handleAIError', () => {
  it('logs userMessage for AIError instances', async () => {
    const { AIError } = await import('../../src/ai/errors.js');
    const err = new AIError('raw msg', 'auth');

    await handleAIError(err);

    expect(logger.error).toHaveBeenCalledWith(err.userMessage);
  });

  it('logs message for generic Error instances', async () => {
    const err = new Error('Something went wrong');

    await handleAIError(err);

    expect(logger.error).toHaveBeenCalledWith('Something went wrong');
  });

  it('re-throws non-Error values', async () => {
    await expect(handleAIError('string error')).rejects.toBe('string error');
  });

  it('re-throws numbers', async () => {
    await expect(handleAIError(42)).rejects.toBe(42);
  });
});

describe('displayTaskPreview', () => {
  it('renders task groups with subtasks', () => {
    const data: TaskPreviewData = {
      tasks: [
        {
          id: 'TASK-001',
          title: 'Setup',
          subtasks: [{ id: '1.1', title: 'Init' }],
        },
      ],
    };

    displayTaskPreview(data);

    expect(display.separator).toHaveBeenCalledWith(50);
    expect(display.heading).toHaveBeenCalledWith('  TASK-001 Setup');
    expect(display.line).toHaveBeenCalledWith(expect.stringContaining('1.1 Init'));
  });

  it('renders acceptance criteria mapping when present', () => {
    const data: TaskPreviewData = {
      tasks: [{ id: 'T-001', title: 'Task' }],
      acceptanceCriteriaMapping: [
        { criterion: 'AC-1', sourceStoryId: 'US-001', taskIds: ['T-001'] },
      ],
    };

    displayTaskPreview(data);

    expect(display.blank).toHaveBeenCalled();
    expect(display.heading).toHaveBeenCalledWith('  Acceptance Criteria Mapping:');
    expect(display.line).toHaveBeenCalledWith(expect.stringContaining('AC-1 (US-001)'));
  });

  it('renders relevant files when present', () => {
    const data: TaskPreviewData = {
      tasks: [{ id: 'T-001', title: 'Task' }],
      relevantFiles: [{ path: 'src/index.ts', reason: 'entry point', action: 'modify' }],
    };

    displayTaskPreview(data);

    expect(display.heading).toHaveBeenCalledWith('  Relevant Files:');
    expect(display.line).toHaveBeenCalledWith(expect.stringContaining('src/index.ts'));
  });

  it('skips acceptance criteria and relevant files when absent', () => {
    vi.mocked(display.blank).mockClear();
    vi.mocked(display.heading).mockClear();

    const data: TaskPreviewData = {
      tasks: [{ id: 'T-001', title: 'Task' }],
    };

    displayTaskPreview(data);

    const headingCalls = vi.mocked(display.heading).mock.calls.map((c) => c[0]);
    expect(headingCalls).not.toContainEqual('  Acceptance Criteria Mapping:');
    expect(headingCalls).not.toContainEqual('  Relevant Files:');
  });

  it('skips empty acceptance criteria array', () => {
    vi.mocked(display.heading).mockClear();

    const data: TaskPreviewData = {
      tasks: [{ id: 'T-001', title: 'Task' }],
      acceptanceCriteriaMapping: [],
    };

    displayTaskPreview(data);

    const headingCalls = vi.mocked(display.heading).mock.calls.map((c) => c[0]);
    expect(headingCalls).not.toContainEqual('  Acceptance Criteria Mapping:');
  });
});

describe('displayNextSteps', () => {
  it('displays next steps for quick command', () => {
    vi.mocked(logger.dim).mockClear();

    displayNextSteps({ command: 'quick', id: 'QT-001' });

    expect(logger.heading).toHaveBeenCalledWith('Next steps:');
    const dimCalls = vi.mocked(logger.dim).mock.calls.map((c) => c[0]);
    expect(dimCalls.some((c) => c.includes('planr quick list'))).toBe(true);
    expect(dimCalls.some((c) => c.includes('coding agent'))).toBe(true);
  });

  it('displays next steps for task command', () => {
    vi.mocked(logger.dim).mockClear();

    displayNextSteps({ command: 'task', id: 'TASK-005' });

    const dimCalls = vi.mocked(logger.dim).mock.calls.map((c) => c[0]);
    expect(dimCalls.some((c) => c.includes('planr task list'))).toBe(true);
  });

  it('appends extra lines when provided', () => {
    vi.mocked(logger.dim).mockClear();

    displayNextSteps({
      command: 'quick',
      id: 'QT-001',
      extras: ['planr task promote QT-001'],
    });

    const dimCalls = vi.mocked(logger.dim).mock.calls.map((c) => c[0]);
    expect(dimCalls.some((c) => c.includes('planr task promote QT-001'))).toBe(true);
  });

  it('does not append extras when not provided', () => {
    vi.mocked(logger.dim).mockClear();

    displayNextSteps({ command: 'quick', id: 'QT-001' });

    // Exactly 3 standard lines (list command, open in agent, rules guide)
    expect(vi.mocked(logger.dim)).toHaveBeenCalledTimes(3);
  });
});
