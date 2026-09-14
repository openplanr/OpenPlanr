import { describe, expect, it } from 'vitest';
import { validateClaimsHaveAnchors } from '../src/services/evidence-service.js';

describe('evidence-service strict claims', () => {
  it('skips Evidence appendix section', () => {
    const md = `## Wins\n\n- No URL here\n\n## Evidence\n\n- [x](https://a.com)\n`;
    const bad = validateClaimsHaveAnchors(md, 1);
    expect(bad.some((c) => !c.ok && c.claimId.startsWith('Evidence'))).toBe(false);
    expect(bad.some((c) => !c.ok && c.claimId.startsWith('Wins'))).toBe(true);
  });

  it('skips full-line italic placeholder bullets', () => {
    const md = `## Wins\n\n- _Edit bullets — add links manually._\n\n- Shipped with no link\n`;
    const bad = validateClaimsHaveAnchors(md, 1).filter((c) => !c.ok);
    expect(bad.map((c) => c.claimId)).toEqual(['Wins:1']);
  });

  it('still flags substantive bullets without anchors', () => {
    const md = `## Wins\n\n- Delivered the auth feature for launch\n`;
    const bad = validateClaimsHaveAnchors(md, 1).filter((c) => !c.ok);
    expect(bad).toHaveLength(1);
    expect(bad[0].claimId).toBe('Wins:0');
  });
});
