import { describe, expect, it } from 'vitest';
import { formatStandupMarkdown, parseStandupTranscript } from '../src/services/standup-parser.js';

describe('standup-parser', () => {
  it('parses labeled sections', () => {
    const raw = `Yesterday: shipped login fix
Today: working on API
Blockers: waiting on design`;
    const p = parseStandupTranscript(raw);
    expect(p.yesterday.some((l) => l.includes('login'))).toBe(true);
    expect(p.today.some((l) => l.includes('API'))).toBe(true);
    expect(p.blockers.some((l) => l.includes('design'))).toBe(true);
  });

  it('formats markdown sections', () => {
    const p = parseStandupTranscript('Today: tests');
    const md = formatStandupMarkdown(p);
    expect(md).toContain('## Today');
    expect(md).toContain('tests');
  });

  it('records segments for future audio sync', () => {
    const p = parseStandupTranscript('Today: one thing');
    expect(p.segments.some((s) => s.section === 'today' && s.text.includes('one'))).toBe(true);
  });
});
