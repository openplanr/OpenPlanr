/**
 * SPEC-004 amendment gate — the single command that proves "the amendment
 * landed and nothing it promised to leave alone moved."
 *
 *  (a) Every file in the recorded v1.2.0 golden-digest map is byte-identical to
 *      its pre-feature state (offending path is named on drift). This covers the
 *      Preserve lists of every prior task — the untouched v1.2 schema surface,
 *      commands/plan.md + ship.md, lib/operate/reducer.mjs (determinism), and
 *      the operating-event fixtures.
 *  (b) registry/roles.json still declares exactly nine delivery roles.
 *  (c) Every schemas/v1.3.0/*.schema.json resolves through
 *      lib/protocol/contracts.mjs (the amendment's additive surface is wired in).
 *  (d) FR6's `create-quick-task` route target and FR7's offline decision brief
 *      validate together in one pass.
 *
 * Additionally guards the T-001 seam: any multi-version, version-agnostic
 * protocol kind (e.g. the compact advisor response) MUST be validated with an
 * explicit `protocolVersion` at every lib/ call site, so no v1.3 artifact
 * silently validates against a v1.2 schema (versionless multi-version lookups
 * resolve to the EARLIEST registered version by design).
 *
 * Stdlib + in-repo modules only.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertProtocolArtifact,
  PROTOCOL_SCHEMA_REGISTRY,
  resolveProtocolSchema,
} from '../lib/protocol/contracts.mjs';
import { createOperatingDecisionBriefArtifact } from '../lib/operate/decision-brief-artifact.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const fixture = (name) => readJson(`conformance/fixtures/operating-board/${name}`);
// Digest over canonical LF bytes: the gate proves CONTENT identity, and a
// CRLF checkout on Windows is platform translation, not a modification. The
// recorded goldens were computed from LF working trees.
const fileDigest = (path) => `sha256:${createHash('sha256')
  .update(readFileSync(join(root, path), 'utf8').replace(/\r\n?/gu, '\n'))
  .digest('hex')}`;

function compareVersions(left, right) {
  const l = left.split('.').map(Number);
  const r = right.split('.').map(Number);
  for (let i = 0; i < Math.max(l.length, r.length); i += 1) {
    const diff = (l[i] ?? 0) - (r[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── (a) Preserved files are byte-identical to their recorded golden digest ────
const golden = fixture('v1-2-0-golden-digests.json');
const goldenPaths = Object.keys(golden);
if (goldenPaths.length === 0) {
  throw new Error('The v1.2.0 golden-digest map is empty; the amendment gate would prove nothing.');
}
for (const path of goldenPaths) {
  const actual = fileDigest(path);
  if (actual !== golden[path]) {
    throw new Error(
      `Preserved file drift: ${path} is ${actual}, but the pre-feature golden is ${golden[path]}. `
      + 'The amendment must not modify any prior task\'s Preserve list.',
    );
  }
}

// ── (b) The nine delivery roles from SPEC-002 are unchanged in count ──────────
const roles = readJson('registry/roles.json').roles;
if (!Array.isArray(roles) || roles.length !== 9) {
  throw new Error(
    `registry/roles.json must declare exactly nine delivery roles; found ${Array.isArray(roles) ? roles.length : 'none'}.`,
  );
}

// ── (c) Every additive v1.3.0 schema resolves through the protocol contracts ──
const v13Files = readdirSync(join(root, 'schemas/v1.3.0'))
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
if (v13Files.length === 0) {
  throw new Error('No schemas/v1.3.0/*.schema.json files found; the amendment surface is missing.');
}
for (const file of v13Files) {
  const kind = file.replace(/\.schema\.json$/, '');
  const registered = PROTOCOL_SCHEMA_REGISTRY[kind]?.['1.3.0'];
  if (registered !== `schemas/v1.3.0/${file}`) {
    throw new Error(`schemas/v1.3.0/${file} is not registered as ${kind}@1.3.0 in lib/protocol/contracts.mjs.`);
  }
  // Throws for an unregistered or unloadable schema.
  resolveProtocolSchema(kind, { protocolVersion: '1.3.0' });
}

// ── (d) FR6 create-quick-task route + FR7 offline decision brief, one pass ────
const quickTask = fixture('route-quick-task-valid.json');
assertProtocolArtifact('operating-route-plan', quickTask, { protocolVersion: '1.3.0' });
const quickAction = quickTask.actions[0];
if (quickAction.kind !== 'create-quick-task') {
  throw new Error('FR6 fixture must exercise the create-quick-task route kind.');
}
if (!(quickAction.lane === 'AGENT' || quickAction.lane === 'DEV')) {
  throw new Error('The create-quick-task action must route to the AGENT or DEV lane.');
}
if (typeof quickAction.targetPath !== 'string' || !quickAction.targetPath.startsWith('.planr/quick/')) {
  throw new Error('The create-quick-task action must target a path under .planr/quick/.');
}

const brief = {
  id: 'operating-decision-brief-CYCLE-011',
  title: 'Should we invest a cycle in onboarding retry copy?',
  question: 'Do we fix the onboarding retry messaging now, or defer to next cycle?',
  evidence: [
    'Activation drops 12% after the first failed retry.',
    'The retry copy has not changed since launch.',
  ],
  options: [
    { label: 'Fix now', detail: 'Ship a bounded copy change this cycle.' },
    { label: 'Defer', detail: 'Revisit after the pricing experiment concludes.' },
  ],
  blocks: 'Blocks **FND-014** from routing to a quick task.',
};
const decision = {
  status: 'open',
  owner: 'founder',
  recommendation: 'Fix now — the change is small, reversible, and evidence-backed.',
};
const envelope = createOperatingDecisionBriefArtifact(brief, decision);
assertProtocolArtifact('artifact-envelope', envelope, { protocolVersion: '1.1.0' });
if (/https?:\/\//i.test(envelope.artifacts[0].html)) {
  throw new Error('The rendered decision brief must contain no external http(s) reference.');
}
const rerender = createOperatingDecisionBriefArtifact(brief, decision);
if (JSON.stringify(rerender) !== JSON.stringify(envelope)) {
  throw new Error('Decision-brief rendering must be deterministic (byte-identical envelopes).');
}

// ── T-001 seam: version-agnostic multi-version kinds need explicit versions ───
const versionAgnosticMultiVersion = [];
for (const [kind, versions] of Object.entries(PROTOCOL_SCHEMA_REGISTRY)) {
  const declared = Object.keys(versions);
  if (declared.length < 2) continue;
  const latest = [...declared].sort(compareVersions).at(-1);
  const { schema } = resolveProtocolSchema(kind, { protocolVersion: latest });
  const property = schema.properties?.protocolVersion;
  if (!property || property.const === undefined) versionAgnosticMultiVersion.push(kind);
}

function listMjs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...listMjs(abs));
    else if (entry.endsWith('.mjs')) out.push(abs);
  }
  return out;
}

const CALL_RE = /(?:assert|validate)ProtocolArtifact\s*\(\s*(['"])([^'"\n]+)\1/g;
const violations = [];
for (const file of listMjs(join(root, 'lib'))) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(CALL_RE)) {
    const kind = match[2];
    if (!versionAgnosticMultiVersion.includes(kind)) continue;
    const window = source.slice(match.index, match.index + 320);
    if (!window.includes('protocolVersion')) {
      violations.push(`${file.slice(root.length + 1)} validates ${kind} without an explicit protocolVersion`);
    }
  }
}
if (violations.length > 0) {
  throw new Error(
    `Version-agnostic multi-version protocol kinds must pass protocolVersion explicitly:\n  ${violations.join('\n  ')}`,
  );
}

process.stdout.write(
  `Operating Board amendment conformance passed (${goldenPaths.length} preserved files byte-identical, `
  + 'nine delivery roles, '
  + `${v13Files.length} v1.3.0 schemas resolvable, create-quick-task + offline decision brief validated).\n`,
);
