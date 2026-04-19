import { describe, expect, it } from 'vitest';
import { validateReportMarkdown } from '../src/services/report-linter-service.js';

describe('report-linter-service', () => {
  it('flags vague language', () => {
    const res = validateReportMarkdown('We almost done with things.', 'weekly', {
      rules: [{ id: 'evidence-density', enabled: false }],
      vaguePhrases: [{ pattern: '\\balmost done\\b', alternatives: ['Completed 3 of 5 stories'] }],
    });
    expect(res.findings.some((f) => f.ruleId === 'vague-language')).toBe(true);
  });

  it('accepts clean weekly headings', () => {
    const md = `## Wins\n\n- Shipped https://example.com/pr/1\n\n## Risks\n\n- None\n\n## Ask\n\n- Need decision\n`;
    const res = validateReportMarkdown(md, 'weekly', {
      rules: [
        { id: 'evidence-density', enabled: true, minEvidenceLinks: 1 },
        { id: 'weekly-structure', enabled: true, requireSections: ['Wins', 'Risks', 'Ask'] },
      ],
      vaguePhrases: [],
    });
    expect(res.findings.filter((f) => f.ruleId === 'weekly-structure')).toHaveLength(0);
  });
});
