import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { display, logger, setVerbose } from '../../src/utils/logger.js';

/** Extract the first argument from the Nth call to console.log (default: 0). */
function lastLogOutput(callIndex = 0): string {
  // biome-ignore lint/suspicious/noExplicitAny: test helper accessing vi mock internals
  // biome-ignore lint/suspicious/noConsole: test helper reading spied console mock
  return (console.log as any).mock.calls[callIndex][0] as string;
}

beforeEach(() => {
  setVerbose(false);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// display.*
// ---------------------------------------------------------------------------

describe('display.line', () => {
  it('outputs the provided text', () => {
    display.line('hello world');
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledWith('hello world');
  });
});

describe('display.blank', () => {
  it('outputs an empty string', () => {
    display.blank();
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledWith('');
  });
});

describe('display.separator', () => {
  it('outputs a separator with default width and char', () => {
    display.separator();
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = lastLogOutput();
    // Default is 50 repetitions of '━' (wrapped in chalk.dim)
    expect(output).toContain('━'.repeat(50));
  });

  it('respects custom width', () => {
    display.separator(10);
    const output = lastLogOutput();
    expect(output).toContain('━'.repeat(10));
    expect(output).not.toContain('━'.repeat(11));
  });

  it('respects custom char', () => {
    display.separator(5, '-');
    const output = lastLogOutput();
    expect(output).toContain('-----');
  });

  it('respects custom width and char together', () => {
    display.separator(3, '=');
    const output = lastLogOutput();
    expect(output).toContain('===');
  });
});

describe('display.heading', () => {
  it('outputs bold text', () => {
    display.heading('My Section');
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = lastLogOutput();
    expect(output).toContain('My Section');
  });
});

describe('display.bullet', () => {
  it('outputs a bulleted item with default indent', () => {
    display.bullet('item one');
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = lastLogOutput();
    // Default indent is 4 spaces + bullet
    expect(output).toBe('    • item one');
  });

  it('respects custom indent', () => {
    display.bullet('item two', 2);
    const output = lastLogOutput();
    expect(output).toBe('  • item two');
  });
});

describe('display.progressBar', () => {
  it('renders a bar at 0%', () => {
    display.progressBar(0);
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = lastLogOutput();
    expect(output).toContain('0%');
    // 0 filled blocks, 20 empty blocks (default width)
    expect(output).toContain('░'.repeat(20));
  });

  it('renders a bar at 50%', () => {
    display.progressBar(50);
    const output = lastLogOutput();
    expect(output).toContain('50%');
    expect(output).toContain('█'.repeat(10));
    expect(output).toContain('░'.repeat(10));
  });

  it('renders a bar at 100%', () => {
    display.progressBar(100);
    const output = lastLogOutput();
    expect(output).toContain('100%');
    expect(output).toContain('█'.repeat(20));
  });

  it('respects custom width', () => {
    display.progressBar(50, 10);
    const output = lastLogOutput();
    expect(output).toContain('█'.repeat(5));
    expect(output).toContain('░'.repeat(5));
  });

  it('includes label when provided', () => {
    display.progressBar(75, 20, { label: 'done' });
    const output = lastLogOutput();
    expect(output).toContain('done');
  });

  it('colors percentage green for >= 75%', () => {
    display.progressBar(80);
    const output = lastLogOutput();
    expect(output).toContain('80%');
  });

  it('colors percentage yellow for >= 25% and < 75%', () => {
    display.progressBar(50);
    const output = lastLogOutput();
    expect(output).toContain('50%');
  });

  it('colors percentage red for < 25%', () => {
    display.progressBar(10);
    const output = lastLogOutput();
    expect(output).toContain('10%');
  });

  it('respects custom indent', () => {
    display.progressBar(50, 20, { indent: 4 });
    const output = lastLogOutput();
    expect(output).toMatch(/^\s{4}/);
  });
});

// ---------------------------------------------------------------------------
// logger.debug — extra coverage complementing logger.test.ts
// ---------------------------------------------------------------------------

describe('logger.debug (extended)', () => {
  it('does not output when verbose is disabled', () => {
    logger.debug('should be hidden');
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).not.toHaveBeenCalled();
  });

  it('outputs when verbose is enabled', () => {
    setVerbose(true);
    logger.debug('visible');
    // biome-ignore lint/suspicious/noConsole: asserting on spied console mock
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = lastLogOutput();
    expect(output).toContain('[DEBUG]');
    expect(output).toContain('visible');
  });

  it('accepts and includes extra arguments', () => {
    setVerbose(true);
    logger.debug('msg', 'extra1', 42);
    const output = lastLogOutput();
    expect(output).toContain('extra1');
    expect(output).toContain('42');
  });

  it('does not include extra args section when none provided', () => {
    setVerbose(true);
    logger.debug('plain');
    const output = lastLogOutput();
    // Should end with the message, no trailing space from extra args
    expect(output).toContain('[DEBUG] plain');
  });
});
