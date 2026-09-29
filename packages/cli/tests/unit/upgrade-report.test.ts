import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  firstSentence,
  printNextSteps,
  printReleaseNotes,
  printUpgradeReport,
  wrapText,
} from '../../src/services/upgrade-report.js';
import type {
  ExecuteCliHalfUpgradeResult,
  UpgradeNextStep,
} from '../../src/services/upgrade-service.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
let printed: string[];

beforeEach(() => {
  printed = [];
  const capture = (...args: unknown[]) => {
    printed.push(args.map(String).join(' ').replace(ANSI, ''));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const steps: UpgradeNextStep[] = [
  {
    runtime: 'claude-code',
    host: 'Claude Code',
    command: 'planr runtime update claude --scope user --yes',
    detail: 'planr plugin 2.6.0 → 2.2640.2',
  },
  {
    runtime: 'codex',
    host: 'Codex',
    command: 'planr runtime update codex --scope user --yes',
    detail: '40 files to update, 18 to add',
  },
];

describe('firstSentence', () => {
  it('keeps the first whole sentence and never cuts inside one', () => {
    expect(firstSentence('Adds `planr x`. Then more.')).toBe('Adds `planr x`.');
    expect(firstSentence('Supports v1.2 files, e.g. old ones')).toBe(
      'Supports v1.2 files, e.g. old ones',
    );
    expect(firstSentence('One sentence only.')).toBe('One sentence only.');
  });
});

describe('wrapText', () => {
  it('wraps at word boundaries within the width', () => {
    expect(wrapText('alpha beta gamma delta', 11)).toEqual(['alpha beta', 'gamma delta']);
    expect(wrapText('extraordinarily long', 5)).toEqual(['extraordinarily', 'long']);
  });
});

describe('printReleaseNotes', () => {
  const sections = [
    {
      version: '2.1.0',
      entries: Array.from({ length: 7 }, (_, index) => `Entry ${index + 1}. Detail.`),
    },
  ];

  it('shows five highlights per release, counts the rest, and links the full notes', () => {
    printReleaseNotes(sections, '2.1.0', 'highlights');
    expect(printed).toContain("What's new");
    expect(printed).toContain('    • Entry 5.');
    expect(printed).not.toContain('    • Entry 6.');
    expect(printed).toContain('    … and 2 more');
    expect(printed).toContain(
      '  Full notes: https://github.com/openplanr/OpenPlanr/releases/tag/openplanr%402.1.0',
    );
  });

  it('prints every entry in full on request', () => {
    printReleaseNotes(sections, '2.1.0', 'full');
    expect(printed).toContain('    • Entry 7. Detail.');
    expect(printed.some((line) => line.includes('more'))).toBe(false);
  });
});

describe('printNextSteps', () => {
  it('numbers each command with its agent, then names every agent to restart', () => {
    printNextSteps(steps);
    expect(printed).toEqual([
      '',
      'Next',
      '    1. planr runtime update claude --scope user --yes',
      '       Claude Code: planr plugin 2.6.0 → 2.2640.2',
      '    2. planr runtime update codex --scope user --yes',
      '       Codex: 40 files to update, 18 to add',
      '  Then restart Claude Code and Codex and check with `planr upgrade status`.',
    ]);
  });

  it('asks for no restart when no step concerns a coding agent', () => {
    printNextSteps([{ host: 'OpenPlanr', command: 'planr doctor', detail: 'state unreadable' }]);
    expect(printed.at(-1)).toBe('  Then check with `planr upgrade status`.');
  });

  it('points at upgrade status when the steps could not be listed', () => {
    printNextSteps([], 'The upgraded CLI could not be run: boom.');
    expect(printed.at(-1)).toBe(
      '⚠ The upgraded CLI could not be run: boom. Run `planr upgrade status` to see what else needs updating.',
    );
  });
});

describe('printUpgradeReport', () => {
  it('reports the version change, the highlights and the next steps', () => {
    const result: ExecuteCliHalfUpgradeResult = {
      ok: true,
      cliUpgraded: true,
      previousVersion: '2.0.0',
      installedVersion: '2.1.0',
      changelogBullets: [],
      releaseNotes: [{ version: '2.1.0', entries: ['Adds a thing.'] }],
      nextSteps: steps.slice(0, 1),
      pluginHalfCommands: [steps[0].command],
      migrations: [],
    };
    printUpgradeReport(result, 'highlights');
    expect(printed[0]).toBe('✓ Upgraded OpenPlanr from 2.0.0 to 2.1.0.');
    expect(printed).toContain('    • Adds a thing.');
    expect(printed).toContain('    1. planr runtime update claude --scope user --yes');
    expect(printed.at(-1)).toBe(
      '  Then restart Claude Code and check with `planr upgrade status`.',
    );
  });
});
