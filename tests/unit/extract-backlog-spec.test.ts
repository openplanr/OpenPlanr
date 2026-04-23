import { describe, expect, it } from 'vitest';
import { extractBacklogSpec } from '../../src/cli/commands/backlog.js';

describe('extractBacklogSpec', () => {
  it('preserves the full backlog body for rich AI-driven promotion', () => {
    const raw = [
      '---',
      'id: "BL-003"',
      'title: "Fix RAG proxy host header spoofing"',
      'priority: "critical"',
      'status: "open"',
      '---',
      '',
      '# BL-003: Fix RAG proxy host header spoofing',
      '',
      '## Description',
      'The RAG proxy trusts the `Host` header for API-key selection.',
      '',
      '## Acceptance Criteria',
      '- Spoofed `Host` headers are rejected before API-key lookup.',
      '- Unit tests cover the spoof path.',
      '',
      '## Notes',
      '- Threat model: see `docs/security/threat-model.md`.',
      '',
      '---',
      '_Promote to agile hierarchy: `planr backlog promote BL-003 --story` or `planr backlog promote BL-003 --quick`_',
      '_Close when done: `planr backlog close BL-003`_',
    ].join('\n');

    const spec = extractBacklogSpec(raw, 'BL-003', 'Fix RAG proxy host header spoofing', 'short');

    expect(spec).toContain('BL-003');
    expect(spec).toContain('Fix RAG proxy host header spoofing');
    expect(spec).toContain('## Description');
    expect(spec).toContain('The RAG proxy trusts the `Host` header for API-key selection.');
    expect(spec).toContain('## Acceptance Criteria');
    expect(spec).toContain('Spoofed `Host` headers are rejected before API-key lookup.');
    expect(spec).toContain('## Notes');
    expect(spec).toContain('Threat model: see `docs/security/threat-model.md`.');
  });

  it('strips the `# BL-XXX: <title>` heading line', () => {
    const raw = [
      '---',
      'id: "BL-010"',
      'title: "Heading gets stripped"',
      '---',
      '',
      '# BL-010: Heading gets stripped',
      '',
      'Body content stays.',
    ].join('\n');

    const spec = extractBacklogSpec(raw, 'BL-010', 'Heading gets stripped', 'fallback');

    expect(spec).not.toMatch(/^#\s+BL-010:/m);
    expect(spec).toContain('Body content stays.');
  });

  it('strips the trailing `_Promote to agile hierarchy..._` helper lines', () => {
    const raw = [
      '---',
      'id: "BL-011"',
      'title: "Promote hint gets stripped"',
      '---',
      '',
      '# BL-011: Promote hint gets stripped',
      '',
      'Real spec content.',
      '',
      '---',
      '_Promote to agile hierarchy: `planr backlog promote BL-011 --story` or `planr backlog promote BL-011 --quick`_',
      '_Close when done: `planr backlog close BL-011`_',
    ].join('\n');

    const spec = extractBacklogSpec(raw, 'BL-011', 'Promote hint gets stripped', 'fallback');

    expect(spec).toContain('Real spec content.');
    expect(spec).not.toContain('Promote to agile hierarchy');
    expect(spec).not.toContain('Close when done');
  });

  it('falls back to the description when the raw body is empty', () => {
    const raw = ['---', 'id: "BL-020"', 'title: "Empty body"', '---', ''].join('\n');

    const spec = extractBacklogSpec(raw, 'BL-020', 'Empty body', 'Add rate limiting to /v1/chat');

    expect(spec).toBe('Add rate limiting to /v1/chat');
  });

  it('falls back to the description when the raw file is missing entirely', () => {
    const spec = extractBacklogSpec('', 'BL-021', 'Missing file', 'fallback text');

    expect(spec).toBe('fallback text');
  });

  it('falls back to the title when both raw and description are empty', () => {
    const spec = extractBacklogSpec('', 'BL-022', 'Title-only', '');

    expect(spec).toBe('Title-only');
  });
});
