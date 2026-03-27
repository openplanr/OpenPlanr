import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown, toMarkdownWithFrontmatter } from '../../src/utils/markdown.js';

const fixturePath = resolve('tests/fixtures/sample-artifact.md');
const fixtureContent = readFileSync(fixturePath, 'utf-8');

describe('parseMarkdown', () => {
  it('extracts frontmatter data', () => {
    const { data } = parseMarkdown(fixtureContent);
    expect(data.id).toBe('EPIC-001');
    expect(data.title).toBe('User Authentication System');
    expect(data.owner).toBe('Engineering');
    expect(data.status).toBe('active');
  });

  it('extracts frontmatter arrays', () => {
    const { data } = parseMarkdown(fixtureContent);
    expect(data.tags).toEqual(['security', 'auth']);
  });

  it('extracts body content without frontmatter', () => {
    const { content } = parseMarkdown(fixtureContent);
    expect(content).toContain('# User Authentication System');
    expect(content).toContain('## Overview');
    expect(content).not.toContain('---');
  });

  it('handles content with no frontmatter', () => {
    const { data, content } = parseMarkdown('# Just a heading\n\nSome body text.');
    expect(data).toEqual({});
    expect(content).toContain('# Just a heading');
  });

  it('handles empty string', () => {
    const { data, content } = parseMarkdown('');
    expect(data).toEqual({});
    expect(content).toBe('');
  });
});

describe('toMarkdownWithFrontmatter', () => {
  it('produces valid markdown with frontmatter', () => {
    const data = { id: 'FEAT-001', title: 'My Feature' };
    const body = '# My Feature\n\nDescription here.';
    const result = toMarkdownWithFrontmatter(data, body);

    expect(result).toContain('---');
    expect(result).toContain('id: FEAT-001');
    expect(result).toContain('title: My Feature');
    expect(result).toContain('# My Feature');
  });

  it('roundtrips correctly with parseMarkdown', () => {
    const originalData = { id: 'US-001', title: 'Login', priority: 'high' };
    const originalContent = '# Login\n\nAs a user I want to log in.';

    const markdown = toMarkdownWithFrontmatter(originalData, originalContent);
    const parsed = parseMarkdown(markdown);

    expect(parsed.data.id).toBe('US-001');
    expect(parsed.data.title).toBe('Login');
    expect(parsed.data.priority).toBe('high');
    expect(parsed.content.trim()).toContain('# Login');
  });

  it('handles complex data types', () => {
    const data = { tags: ['a', 'b'], nested: { key: 'value' } };
    const result = toMarkdownWithFrontmatter(data, 'Body');
    const parsed = parseMarkdown(result);

    expect(parsed.data.tags).toEqual(['a', 'b']);
    expect(parsed.data.nested).toEqual({ key: 'value' });
  });
});
