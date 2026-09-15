import { describe, expect, it } from 'vitest';
import { markdownToBasicHtml, stripLeadingMarkdownH1 } from '../../src/services/report-service.js';

describe('report-service HTML helpers', () => {
  it('stripLeadingMarkdownH1 removes first # title and following blank lines', () => {
    const md = '# Weekly update — Acme\n\n## Wins\n\n- Done https://x.com/1\n';
    expect(stripLeadingMarkdownH1(md)).toBe('## Wins\n\n- Done https://x.com/1\n');
  });

  it('stripLeadingMarkdownH1 is a no-op when the first line is not H1', () => {
    const md = '## Wins\n\n- x\n';
    expect(stripLeadingMarkdownH1(md)).toBe(md);
  });

  it('markdown body after strip has no extra top-level h1 from template title', () => {
    const md = '# Report title\n\n## Section\n\n- item\n';
    const html = markdownToBasicHtml(stripLeadingMarkdownH1(md));
    expect(html).toContain('<h2>');
    expect(html).not.toContain('<h1>');
  });

  it('inlineMd rejects javascript: URLs in links', () => {
    const md = '- [x](javascript:alert(1))\n';
    const html = markdownToBasicHtml(md);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain('javascript:alert(1)');
  });

  it('inlineMd allows http(s) links with rel noopener noreferrer', () => {
    const md = '- [PR](https://github.com/a/b/pull/1)\n';
    const html = markdownToBasicHtml(md);
    expect(html).toContain('href="https://github.com/a/b/pull/1"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
