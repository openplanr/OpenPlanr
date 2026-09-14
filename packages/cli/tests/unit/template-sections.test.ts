import { describe, expect, it } from 'vitest';
import { getCanonicalSections } from '../../src/services/template-sections.js';

describe('getCanonicalSections', () => {
  it('returns the epic section set matching src/templates/epics/epic.md.hbs', () => {
    const sections = getCanonicalSections('epic');
    expect(sections).toEqual([
      'Business Value',
      'Target Users',
      'Problem Statement',
      'Solution Overview',
      'Success Criteria',
      'Key Features',
      'Dependencies',
      'Risks',
      'Features',
    ]);
  });

  it('does NOT include `Relevant Files` in the epic section set (regression guard)', () => {
    // Protects against the real-world failure where revise added a task-level
    // `## Relevant Files` section to an epic. If someone adds it to the epic
    // template deliberately, they must update this guard too.
    const sections = getCanonicalSections('epic');
    expect(sections).not.toContain('Relevant Files');
  });

  it('returns the feature section set matching the template', () => {
    expect(getCanonicalSections('feature')).toEqual([
      'Overview',
      'Functional Requirements',
      'User Stories',
      'Dependencies',
      'Technical Considerations',
      'Risks',
      'Success Metrics',
    ]);
  });

  it('returns the story section set matching the template', () => {
    expect(getCanonicalSections('story')).toEqual([
      'User Story',
      'Acceptance Criteria',
      'Additional Notes',
      'Tasks',
    ]);
  });

  it('returns the task section set — and INCLUDES `Relevant Files` (it is a task-level convention)', () => {
    const sections = getCanonicalSections('task');
    expect(sections).toEqual([
      'Artifact Sources',
      'Tasks',
      'Acceptance Criteria Mapping',
      'Relevant Files',
      'Notes',
    ]);
  });

  it('returns undefined for artifact types with no enforced section list', () => {
    expect(getCanonicalSections('quick')).toBeUndefined();
    expect(getCanonicalSections('backlog')).toBeUndefined();
    expect(getCanonicalSections('sprint')).toBeUndefined();
    expect(getCanonicalSections('adr')).toBeUndefined();
    expect(getCanonicalSections('checklist')).toBeUndefined();
  });
});
