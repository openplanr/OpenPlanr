import { describe, expect, it } from 'vitest';
import { injectStandupSection } from '../src/services/story-standup-service.js';

describe('story-standup-service', () => {
  it('inserts Standup notes before ## Tasks', () => {
    const raw = `---\nid: US-1\n---\n\n# Story\n\n## Tasks\n\n- x\n`;
    const next = injectStandupSection(raw, '## Yesterday\n\n- a', '2026-04-18');
    expect(next).toContain('## Standup notes');
    expect(next).toContain('## Yesterday');
    expect(next.indexOf('## Standup notes')).toBeLessThan(next.indexOf('## Tasks'));
  });

  it('appends to existing Standup notes', () => {
    const raw = `## Standup notes\n\n### Old\n\nx\n\n## Tasks\n`;
    const next = injectStandupSection(raw, 'new', '2026-04-19');
    expect(next).toContain('### 2026-04-19');
    expect(next).toContain('new');
  });
});
