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
/**
 * Return the canonical section list for an artifact type, or `undefined`
 * when the type has no enforced convention (e.g., `backlog`).
 */
export declare function getCanonicalSections(type: ArtifactType): readonly string[] | undefined;
//# sourceMappingURL=template-sections.d.ts.map