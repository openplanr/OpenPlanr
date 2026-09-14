import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/utils/slugify.js';

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('User Authentication & OAuth')).toBe('user-authentication-oauth');
  });

  it('collapses multiple spaces and dashes', () => {
    expect(slugify('some   text---here')).toBe('some-text-here');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('replaces underscores with dashes', () => {
    expect(slugify('my_cool_feature')).toBe('my-cool-feature');
  });

  it('truncates long text to 80 characters by default', () => {
    const long = 'a '.repeat(100); // 200 chars before slugify
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it('truncates at whole-word boundary', () => {
    const text =
      'when generating tasks for a feature with the feature flag the tasks generated file name should match the id of the feat passed so if it is planr task create';
    const result = slugify(text);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false); // no trailing dash
  });

  it('respects custom maxLength', () => {
    const result = slugify('hello wonderful beautiful world', 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toBe('hello-wonderful');
  });

  it('does not truncate short text', () => {
    expect(slugify('short title')).toBe('short-title');
  });
});
