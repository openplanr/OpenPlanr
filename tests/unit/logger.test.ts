import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, setVerbose, isVerbose } from '../../src/utils/logger.js';

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
