#!/usr/bin/env node
/**
 * BL-010: guard the hand-inlined frontmatter examples in the skills package
 * against the canonical JSON Schemas in planr-pipeline.
 *
 * packages/skills/skills/openplanr/SKILL.md teaches agents the artifact
 * frontmatter by embedding YAML examples that were hand-copied from
 * packages/planr-pipeline/schemas/v1.0.0/{spec,story,task}.schema.json. Nothing
 * has ever validated that copy. Before the monorepo the two lived in separate
 * repositories, so the drift was not even mechanically checkable; co-location is
 * what makes this gate possible, and skills has never had CI of its own.
 *
 * Two directions are checked, because each fails differently:
 *   - a key in the example that the schema does not define => the skill teaches
 *     agents to emit a field the validator will reject;
 *   - a REQUIRED schema property missing from the example => the skill teaches
 *     agents to omit a field the validator demands.
 *
 * Usage: node scripts/check-cross-refs.mjs   (non-zero on drift)
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = join(root, 'packages');
const skillPath = join(packages, 'skills/skills/openplanr/SKILL.md');
const schemaDir = join(packages, 'planr-pipeline/schemas/v1.0.0');

const skill = readFileSync(skillPath, 'utf8');

/**
 * The examples are fenced ```yaml blocks delimited by --- frontmatter markers and
 * introduced by a bold label naming the artifact kind, e.g.
 *   **Task (`tasks/T-NNN-*.md`):**
 * Match label -> block so a block is only compared against its own schema.
 */
const KINDS = [
  // `required: false` = no example exists in SKILL.md today. If one is added later
  // it starts being checked automatically; the required ones must never silently
  // disappear, which would turn this gate into a green-looking no-op.
  { kind: 'spec', label: /\*\*Spec\b/i, required: false },
  { kind: 'story', label: /\*\*(User )?Stor(y|ies)\b/i, required: true },
  { kind: 'task', label: /\*\*Task\b/i, required: true },
];

const blocks = [...skill.matchAll(/\*\*[^\n]*\*\*[^\n]*\n+```yaml\n---\n([\s\S]*?)\n---\n```/g)].map(
  (m) => ({ header: skill.slice(Math.max(0, m.index - 200), m.index + 80), body: m[1] })
);

if (blocks.length === 0) {
  console.error(`No inlined frontmatter examples found in ${skillPath}.`);
  console.error('If the examples moved, update this gate rather than deleting it.');
  process.exit(1);
}

/** Top-level YAML keys of an example block (comments and nesting ignored). */
const keysOf = (body) =>
  body
    .split('\n')
    .map((line) => /^([A-Za-z_][\w-]*):/.exec(line)?.[1])
    .filter(Boolean);

const problems = [];
let compared = 0;

for (const { kind, label, required: kindRequired } of KINDS) {
  const block = blocks.find((b) => label.test(b.header));
  if (!block) {
    if (kindRequired) {
      problems.push(
        `${kind}: no inlined frontmatter example found in SKILL.md — it previously had one. ` +
          'Restore it, or move this kind to required:false deliberately.'
      );
    }
    continue;
  }

  const schema = JSON.parse(readFileSync(join(schemaDir, `${kind}.schema.json`), 'utf8'));
  const defined = new Set(Object.keys(schema.properties ?? {}));
  const required = schema.required ?? [];
  const present = new Set(keysOf(block.body));
  compared += 1;

  for (const key of present) {
    if (!defined.has(key)) {
      problems.push(`${kind}: SKILL.md teaches "${key}", not defined by ${kind}.schema.json`);
    }
  }
  for (const key of required) {
    if (!present.has(key)) {
      problems.push(`${kind}: ${kind}.schema.json REQUIRES "${key}", absent from the SKILL.md example`);
    }
  }
}

if (compared === 0) {
  console.error('Found frontmatter examples but could not match any to a schema kind.');
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`Cross-reference drift between SKILL.md and schemas/v1.0.0 (${compared} kinds compared):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`SKILL.md frontmatter examples match schemas/v1.0.0 (${compared} kinds compared).`);
