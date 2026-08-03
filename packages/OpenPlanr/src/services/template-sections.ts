/**
 * Canonical section lists per artifact type.
 *
 * The revise prompt uses these to give the agent a *soft* conformance hint:
 * "these are the sections a ${type} artifact canonically has — don't invent
 * new ones; flag instead." This prevents the failure mode where the agent
 * helpfully adds something like `## Relevant Files` to an epic (a task-level
 * convention) when there is no drift justifying it.
 *
 * The lists mirror what the Handlebars templates in `src/templates/<type>/`
 * actually emit. Kept hardcoded rather than parsed from the .hbs files at
 * runtime because:
 *
 *   1. Handlebars templates contain `{{ }}` interpolation that would need
 *      stripping before we could grep `## ` headings.
 *   2. If a template gains a new section, we want an explicit review step
 *      in this file, not silent pickup.
 *   3. Parsing templates would couple revise to handlebars internals.
 *
 * When you add or rename a template section, update the matching entry here.
 */

import type { ArtifactType } from '../models/types.js';

const CANONICAL_SECTIONS: Partial<Record<ArtifactType, readonly string[]>> = {
  epic: [
    'Business Value',
    'Target Users',
    'Problem Statement',
    'Solution Overview',
    'Success Criteria',
    'Key Features',
    'Dependencies',
    'Risks',
    'Features',
  ],
  feature: [
    'Overview',
    'Functional Requirements',
    'User Stories',
    'Dependencies',
    'Technical Considerations',
    'Risks',
    'Success Metrics',
  ],
  story: ['User Story', 'Acceptance Criteria', 'Additional Notes', 'Tasks'],
  task: ['Artifact Sources', 'Tasks', 'Acceptance Criteria Mapping', 'Relevant Files', 'Notes'],
  // `quick`, `backlog`, `sprint`, `adr`, `checklist` — no canonical list
  // enforced. Revise will skip the template-structure hint for these types.
};

/**
 * Return the canonical section list for an artifact type, or `undefined`
 * when the type has no enforced convention (e.g., `backlog`).
 */
export function getCanonicalSections(type: ArtifactType): readonly string[] | undefined {
  return CANONICAL_SECTIONS[type];
}
