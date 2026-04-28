/**
 * `applyAllCheckboxes` — pure body-flip helper for BL-015's bulk subtask
 * completion. Tests preserve-everything-except-checkboxes guarantee.
 */

import { describe, expect, it } from 'vitest';
import { applyAllCheckboxes } from '../../src/utils/markdown.js';

describe('applyAllCheckboxes', () => {
  it('flips every `[ ]` to `[x]` when done=true', () => {
    const before = ['- [ ] **1.0** First', '  - [ ] 1.1 Sub', '- [ ] **2.0** Second'].join('\n');
    expect(applyAllCheckboxes(before, true)).toBe(
      ['- [x] **1.0** First', '  - [x] 1.1 Sub', '- [x] **2.0** Second'].join('\n'),
    );
  });

  it('flips every `[x]` to `[ ]` when done=false', () => {
    const before = ['- [x] **1.0** First', '  - [x] 1.1 Sub'].join('\n');
    expect(applyAllCheckboxes(before, false)).toBe(
      ['- [ ] **1.0** First', '  - [ ] 1.1 Sub'].join('\n'),
    );
  });

  it('flips a mix (some checked, some not)', () => {
    const before = ['- [x] **1.0** Done', '- [ ] **2.0** Not yet'].join('\n');
    expect(applyAllCheckboxes(before, true)).toBe(
      ['- [x] **1.0** Done', '- [x] **2.0** Not yet'].join('\n'),
    );
  });

  it('preserves frontmatter, headings, prose, and non-checkbox lines byte-for-byte', () => {
    const before = [
      '---',
      'id: "TASK-001"',
      'title: "Sample"',
      '---',
      '',
      '# TASK-001: Sample',
      '',
      '## Notes',
      '',
      'This is prose. It contains the literal text `- [ ] not-a-real-checkbox`.',
      '',
      '## Tasks',
      '',
      '- [ ] **1.0** Real checkbox',
      '  - [ ] 1.1 Real subtask',
      '',
      '## Relevant Files',
      '',
      '- `src/foo.ts` — bullet that is not a task checkbox',
    ].join('\n');
    const after = applyAllCheckboxes(before, true);
    // Real checkboxes flipped:
    expect(after).toContain('- [x] **1.0** Real checkbox');
    expect(after).toContain('  - [x] 1.1 Real subtask');
    // Frontmatter preserved:
    expect(after).toContain('---\nid: "TASK-001"');
    // Heading preserved:
    expect(after).toContain('# TASK-001: Sample');
    // Prose with checkbox-like text inside backticks NOT touched (the regex
    // requires `^(\s*)- [...]` AND a `\d+\.\d+` id, so prose lines stay safe):
    expect(after).toContain('`- [ ] not-a-real-checkbox`');
    // Relevant Files bullet (no checkbox shape) untouched:
    expect(after).toContain('- `src/foo.ts` — bullet that is not a task checkbox');
  });

  it('returns input unchanged when there are no `N.M` checkboxes', () => {
    const before = ['# Title', '', 'Just prose, no tasks here.'].join('\n');
    expect(applyAllCheckboxes(before, true)).toBe(before);
    expect(applyAllCheckboxes(before, false)).toBe(before);
  });

  it('is idempotent — applying the same direction twice equals applying once', () => {
    const before = '- [ ] **1.0** A\n- [ ] **2.0** B';
    const once = applyAllCheckboxes(before, true);
    const twice = applyAllCheckboxes(once, true);
    expect(twice).toBe(once);
  });
});
