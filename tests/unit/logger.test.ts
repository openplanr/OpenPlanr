import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setVerbose, isVerbose, formatUsage } from '../../src/utils/logger.js';

beforeEach(() => {
  setVerbose(false);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    expect(console.log).not.toHaveBeenCalled();
  });

  it('outputs when verbose is on', () => {
    setVerbose(true);
    logger.debug('visible message');
    expect(console.log).toHaveBeenCalledTimes(1);
    const output = (console.log as any).mock.calls[0][0];
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
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('success outputs to console.log', () => {
    logger.success('test success');
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('warn outputs to console.log', () => {
    logger.warn('test warn');
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('error outputs to console.error', () => {
    logger.error('test error');
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('heading outputs to console.log', () => {
    logger.heading('test heading');
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('dim outputs to console.log', () => {
    logger.dim('test dim');
    expect(console.log).toHaveBeenCalledTimes(1);
  });
});
