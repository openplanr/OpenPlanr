import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESIGN_SKILL_IDS = Object.freeze([
  'planr-design',
  'planr-design-loop',
  'planr-design-review',
]);

const DESIGN_SCHEMAS = Object.freeze([
  ['design-document', 'v1.22.0'],
  ['design-review-context', 'v1.10.0'],
  ['design-review-handoff', 'v1.10.0'],
]);

/**
 * The document and review contracts the design skills and Plan link from their instructions.
 * Design operations run in the `openplanr` CLI, so no skill ships a design runtime.
 */
export function buildDesignSkillResources({ repoRoot } = {}) {
  const root = resolve(repoRoot ?? fileURLToPath(new URL('../..', import.meta.url)));
  return DESIGN_SCHEMAS.map(([name, version]) => ({
    path: `schemas/${name}.schema.json`,
    kind: 'schema',
    executable: false,
    bytes: readFileSync(resolve(root, `packages/protocol/schemas/${version}/${name}.schema.json`)),
  }));
}
