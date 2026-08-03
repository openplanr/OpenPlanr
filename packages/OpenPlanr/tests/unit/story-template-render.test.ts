/**
 * Regression tests for BL-004 — user-story prompt/template mismatch.
 *
 * The template at src/templates/stories/user-story.md.hbs prepends the
 * "As a" / "I want to" / "So that" prefixes itself. Before BL-004 shipped,
 * the AI prompt was instructing the model to return `role` as
 * "As a <role>" (with the prefix baked in), so every generated story came
 * out with doubled prefixes like "**As a** As a product manager".
 *
 * These tests ensure the template renders correctly when fed raw fragment
 * values (what the fixed prompt now asks the model to return). If someone
 * re-introduces the doubled-prefix bug by editing either the prompt or the
 * template, these tests catch it.
 */

import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/services/template-service.js';

describe('user-story.md.hbs rendering (BL-004 regression)', () => {
  it('renders exactly one "**As a**" prefix when role is a raw fragment', async () => {
    const rendered = await renderTemplate('stories/user-story.md.hbs', {
      id: 'US-999',
      title: 'Sample story',
      featureId: 'FEAT-999',
      featureFilename: 'FEAT-999-sample',
      date: '2026-04-22',
      role: 'product manager',
      goal: 'preview the Linear structure',
      benefit: 'I can verify the hierarchy before API calls',
    });

    // Load-bearing assertions — the exact shape the template should emit.
    const asAMatches = rendered.match(/\*\*As a\*\*/g) ?? [];
    expect(asAMatches).toHaveLength(1);
    expect(rendered).toContain('**As a** product manager');
    expect(rendered).not.toContain('As a As a');

    const wantMatches = rendered.match(/\*\*I want to\*\*/g) ?? [];
    expect(wantMatches).toHaveLength(1);
    expect(rendered).toContain('**I want to** preview the Linear structure');
    expect(rendered).not.toContain('I want to I want to');

    const soThatMatches = rendered.match(/\*\*So that\*\*/g) ?? [];
    expect(soThatMatches).toHaveLength(1);
    expect(rendered).toContain('**So that** I can verify the hierarchy');
    expect(rendered).not.toContain('So that So that');
  });

  it('still renders correctly when the fragment is a short phrase', async () => {
    const rendered = await renderTemplate('stories/user-story.md.hbs', {
      id: 'US-998',
      title: 'Short story',
      featureId: 'FEAT-998',
      featureFilename: 'FEAT-998-short',
      date: '2026-04-22',
      role: 'user',
      goal: 'log in',
      benefit: 'I can access my data',
    });
    expect(rendered).toMatch(/^\*\*As a\*\* user\s*$/m);
    expect(rendered).toMatch(/^\*\*I want to\*\* log in\s*$/m);
    expect(rendered).toMatch(/^\*\*So that\*\* I can access my data\s*$/m);
  });
});

describe('gherkin.feature.hbs rendering (BL-004 regression — gherkin keywords)', () => {
  it('renders exactly one "Given" / "When" / "Then" keyword per step', async () => {
    const rendered = await renderTemplate('stories/gherkin.feature.hbs', {
      id: 'US-997',
      title: 'Linear auth',
      role: 'product manager',
      goal: 'store a Linear PAT securely',
      benefit: 'I can authenticate future API calls',
      scenarios: [
        {
          name: 'Happy path',
          given: 'no Linear PAT is configured',
          when: 'I run `planr linear init`',
          then: 'the PAT prompt appears',
        },
      ],
    });

    // Step keywords should appear exactly once per line, prepended by the template.
    // The header line "Given the system is initialized" also counts, so expect 2 'Given' total.
    const givenMatches = rendered.match(/^\s+Given\b/gm) ?? [];
    expect(givenMatches.length).toBe(2); // background + our scenario
    expect(rendered).toContain('    Given no Linear PAT is configured');
    expect(rendered).not.toContain('Given Given');

    expect(rendered).toContain('    When I run `planr linear init`');
    expect(rendered).not.toContain('When When');

    expect(rendered).toContain('    Then the PAT prompt appears');
    expect(rendered).not.toContain('Then Then');
  });
});
