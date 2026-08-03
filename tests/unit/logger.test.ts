import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSpinner,
  formatUsage,
  isVerbose,
  logger,
  setVerbose,
} from '../../src/utils/logger.js';

const logSpy = () => vi.spyOn(console, 'log').mockImplementation(() => {});
const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

let spyLog: ReturnType<typeof vi.spyOn>;
let spyErr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setVerbose(false);
  spyLog = logSpy();
  spyErr = errSpy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Extract output from a spied console.log call. */
function mockLogOutput(callIndex = 0, argIndex = 0): string {
  return spyLog.mock.calls[callIndex][argIndex] as string;
}

describe('setVerbose / isVerbose', () => {
  it('defaults to false', () => {
    expect(isVerbose()).toBe(false);
  });

  it('can be enabled', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  it('can be toggled off', () => {
    setVerbose(true);
    setVerbose(false);
    expect(isVerbose()).toBe(false);
  });
});

describe('logger.debug', () => {
  it('does not output when verbose is off', () => {
    logger.debug('hidden message');
    expect(spyLog).not.toHaveBeenCalled();
  });

  it('outputs when verbose is on', () => {
    setVerbose(true);
    logger.debug('visible message');
    expect(spyLog).toHaveBeenCalledTimes(1);
    const output = mockLogOutput();
    expect(output).toContain('[DEBUG]');
    expect(output).toContain('visible message');
  });
});

describe('formatUsage', () => {
  it('returns empty string for undefined', () => {
    expect(formatUsage(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(formatUsage(null)).toBe('');
  });

  it('formats usage with locale-separated numbers', () => {
    const result = formatUsage({ inputTokens: 1240, outputTokens: 860 });
    expect(result).toContain('1,240');
    expect(result).toContain('860');
    expect(result).toContain('in');
    expect(result).toContain('out');
    expect(result).toContain('tokens');
  });

  it('handles zero tokens', () => {
    const result = formatUsage({ inputTokens: 0, outputTokens: 0 });
    expect(result).toContain('0');
    expect(result).toContain('tokens');
  });

  it('formats large numbers with commas', () => {
    const result = formatUsage({ inputTokens: 12400, outputTokens: 8200 });
    expect(result).toContain('12,400');
    expect(result).toContain('8,200');
  });
});

describe('logger standard methods', () => {
  it('info outputs to console.log', () => {
    logger.info('test info');
    expect(spyLog).toHaveBeenCalledTimes(1);
  });

  it('success outputs to console.log', () => {
    logger.success('test success');
    expect(spyLog).toHaveBeenCalledTimes(1);
  });

  it('warn outputs to console.log', () => {
    logger.warn('test warn');
    expect(spyLog).toHaveBeenCalledTimes(1);
  });

  it('error outputs to console.error', () => {
    logger.error('test error');
    expect(spyErr).toHaveBeenCalledTimes(1);
  });

  it('heading outputs to console.log', () => {
    logger.heading('test heading');
    expect(spyLog).toHaveBeenCalledTimes(1);
  });

  it('dim outputs to console.log', () => {
    logger.dim('test dim');
    expect(spyLog).toHaveBeenCalledTimes(1);
  });
});

describe('createSpinner', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('writes spinner frame on creation', () => {
    const spinner = createSpinner('Loading...');
    spinner.stop();
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('stop clears the spinner line', () => {
    const spinner = createSpinner('Loading...');
    spinner.stop();
    // Last write should clear the line
    const lastCall = stdoutSpy.mock.calls[stdoutSpy.mock.calls.length - 1][0] as string;
    expect(lastCall).toMatch(/\r\s+\r/);
  });

  it('update changes the message', () => {
    const spinner = createSpinner('First');
    spinner.update('Second');
    spinner.stop();
    // Verify update was called without error
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('succeed prints green checkmark message', () => {
    const spinner = createSpinner('Loading...');
    spinner.succeed('Done!');
    expect(spyLog).toHaveBeenCalled();
    const output = mockLogOutput(0, 1);
    expect(output).toContain('Done!');
  });
});
