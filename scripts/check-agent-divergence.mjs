#!/usr/bin/env node
/**
 * BL-010 Phase 3.7: freeze the vendored-agent divergence, do NOT reconcile it.
 *
 * packages/OpenPlanr/src/templates/rules/cursor/agents/*-agent.md are vendored
 * copies of packages/planr-pipeline/agents/*-agent.md, and they have drifted
 * 1.5x-6x. Reconciling them inside the monorepo merge would be a behavior change
 * disguised as cleanup: those template files are written into END-USER projects,
 * so rewriting them changes how other people's agents behave, in a commit whose
 * stated purpose is "move files around". That is the kind of change nobody would
 * think to look for in a merge diff.
 *
 * So: record the divergence that exists TODAY as the accepted baseline and fail
 * only when it CHANGES. Co-location is what makes even this much checkable — the
 * two trees were previously in separate repositories.
 *
 * Reconciliation is tracked as its own follow-up.
 *
 * Usage:
 *   node scripts/check-agent-divergence.mjs           # verify against baseline
 *   node scripts/check-agent-divergence.mjs --update  # re-record (deliberate only)
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = join(root, 'packages');
const baselinePath = join(root, 'scripts', 'agent-divergence-baseline.json');
const update = process.argv.includes('--update');

const AGENTS = ['backend', 'specification', 'designer', 'frontend', 'qa', 'devops', 'doc-gen'];

const digest = (path) =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16) : null;

const current = {};
for (const agent of AGENTS) {
  const vendored = join(packages, 'OpenPlanr/src/templates/rules/cursor/agents', `${agent}-agent.md`);
  const canonical = join(packages, 'planr-pipeline/agents', `${agent}-agent.md`);
  const v = digest(vendored);
  const c = digest(canonical);
  if (v === null && c === null) continue;
  current[agent] = { vendored: v, canonical: c, identical: v !== null && v === c };
}

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Recorded divergence baseline for ${Object.keys(current).length} agents.`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`Missing ${baselinePath}. Run with --update to record the baseline.`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const problems = [];

for (const agent of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
  const was = baseline[agent];
  const now = current[agent];
  if (!now) {
    problems.push(`${agent}: agent file(s) disappeared`);
    continue;
  }
  if (!was) {
    problems.push(`${agent}: new agent pair appeared — run --update to accept it`);
    continue;
  }
  if (was.vendored !== now.vendored) {
    problems.push(`${agent}: VENDORED copy changed (ships into end-user projects) ${was.vendored} -> ${now.vendored}`);
  }
  if (was.canonical !== now.canonical) {
    problems.push(`${agent}: canonical copy changed ${was.canonical} -> ${now.canonical}`);
  }
}

if (problems.length > 0) {
  console.error('Vendored-agent drift changed relative to the recorded baseline:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nIf the change is intended, re-record with: node scripts/check-agent-divergence.mjs --update');
  process.exit(1);
}

const diverged = Object.values(current).filter((e) => !e.identical).length;
console.log(
  `Vendored-agent divergence unchanged (${Object.keys(current).length} agents, ${diverged} diverged — accepted baseline).`
);
