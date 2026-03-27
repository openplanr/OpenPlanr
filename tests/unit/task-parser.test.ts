import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseTaskMarkdown,
  findSubtasks,
  getNextPending,
  formatSubtaskList,
} from '../../src/agents/task-parser.js';

const fixturePath = resolve('tests/fixtures/sample-task-list.md');
const fixtureContent = readFileSync(fixturePath, 'utf-8');

describe('parseTaskMarkdown', () => {
  it('parses all tasks and subtasks from markdown', () => {
    const tasks = parseTaskMarkdown(fixtureContent);
    expect(tasks).toHaveLength(8);
  });

  it('identifies group tasks at depth 0', () => {
    const tasks = parseTaskMarkdown(fixtureContent);
    const groups = tasks.filter((t) => t.depth === 0);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.id)).toEqual(['1.0', '2.0', '3.0']);
  });

  it('identifies subtasks at depth 1 with correct parentId', () => {
    const tasks = parseTaskMarkdown(fixtureContent);
    const subtasks = tasks.filter((t) => t.depth === 1);
    expect(subtasks).toHaveLength(5);
    expect(subtasks[0]).toMatchObject({ id: '1.1', parentId: '1.0' });
    expect(subtasks[2]).toMatchObject({ id: '2.1', parentId: '2.0' });
  });

  it('parses done status correctly', () => {
    const tasks = parseTaskMarkdown(fixtureContent);
    const doneIds = tasks.filter((t) => t.done).map((t) => t.id);
    expect(doneIds).toEqual(['1.0', '1.1']);
  });

  it('returns empty array for content with no tasks', () => {
    const tasks = parseTaskMarkdown('# Just a heading\n\nSome text');
    expect(tasks).toEqual([]);
  });

  it('parses task titles correctly', () => {
    const tasks = parseTaskMarkdown(fixtureContent);
    expect(tasks[0].title).toBe('Setup authentication module');
    expect(tasks[3].title).toBe('Implement login endpoint');
  });
});

describe('findSubtasks', () => {
  const tasks = parseTaskMarkdown(fixtureContent);

  it('finds exact ID match', () => {
    const result = findSubtasks(tasks, '2.1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2.1');
  });

  it('finds group and all its children for x.0 query', () => {
    const result = findSubtasks(tasks, '2.0');
    expect(result).toHaveLength(4); // 2.0, 2.1, 2.2, 2.3
    expect(result.map((t) => t.id)).toEqual(['2.0', '2.1', '2.2', '2.3']);
  });

  it('falls back to keyword search when no ID match', () => {
    const result = findSubtasks(tasks, 'login');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((t) => t.title.toLowerCase().includes('login'))).toBe(true);
  });

  it('returns empty array for no match', () => {
    const result = findSubtasks(tasks, 'nonexistent-xyz');
    expect(result).toEqual([]);
  });

  it('keyword search is case-insensitive', () => {
    const result = findSubtasks(tasks, 'LOGIN');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getNextPending', () => {
  it('returns first unchecked subtask (depth > 0 preferred)', () => {
    const tasks = parseTaskMarkdown(fixtureContent);
    const next = getNextPending(tasks);
    expect(next).not.toBeNull();
    expect(next!.id).toBe('1.2'); // first unchecked subtask
    expect(next!.done).toBe(false);
  });

  it('returns null when all tasks are done', () => {
    const allDone = [
      { id: '1.0', title: 'Done', done: true, parentId: null, depth: 0 },
      { id: '1.1', title: 'Also done', done: true, parentId: '1.0', depth: 1 },
    ];
    expect(getNextPending(allDone)).toBeNull();
  });

  it('prefers depth > 0 over depth 0', () => {
    const mixed = [
      { id: '1.0', title: 'Group', done: false, parentId: null, depth: 0 },
      { id: '1.1', title: 'Subtask', done: false, parentId: '1.0', depth: 1 },
    ];
    const next = getNextPending(mixed);
    expect(next!.id).toBe('1.1');
  });

  it('falls back to depth 0 if all subtasks are done', () => {
    const onlyGroup = [
      { id: '1.0', title: 'Group', done: false, parentId: null, depth: 0 },
      { id: '1.1', title: 'Subtask', done: true, parentId: '1.0', depth: 1 },
    ];
    const next = getNextPending(onlyGroup);
    expect(next!.id).toBe('1.0');
  });
});

describe('formatSubtaskList', () => {
  const tasks = parseTaskMarkdown(fixtureContent);

  it('formats tasks with checkboxes and indentation', () => {
    const output = formatSubtaskList(tasks);
    expect(output).toContain('- [x] 1.0 Setup authentication module');
    expect(output).toContain('  - [x] 1.1 Create auth directory structure');
    expect(output).toContain('  - [ ] 2.1 Create login route handler');
  });

  it('highlights target ID', () => {
    const output = formatSubtaskList(tasks, '2.1');
    expect(output).toContain('2.1 Create login route handler ← TARGET');
  });

  it('does not highlight when no highlightId', () => {
    const output = formatSubtaskList(tasks);
    expect(output).not.toContain('← TARGET');
  });
});
