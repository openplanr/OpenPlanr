import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = join(root, 'skills', 'planr-operate');
const skill = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8');
const ecosystemRoot = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(root, '..'));

test('the standalone skill and references remain byte-identical to generated Codex assets', () => {
  const canonicalRoot = resolve(
    ecosystemRoot, 'planr-pipeline', 'adapters', 'codex', 'skills', 'planr-operate',
  );
  const compare = (relative) => {
    assert.equal(
      readFileSync(join(skillRoot, relative), 'utf8'),
      readFileSync(join(canonicalRoot, relative), 'utf8'),
      relative,
    );
  };
  compare('SKILL.md');
  for (const file of readdirSync(join(skillRoot, 'references'))) {
    if (file.endsWith('.md')) compare(join('references', file));
  }
  for (const file of readdirSync(join(skillRoot, 'references', 'roles'))) {
    if (file.endsWith('.md')) compare(join('references', 'roles', file));
  }
});

test('Windows checkouts preserve canonical generated-skill bytes', () => {
  const attributes = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^skills\/planr-operate\/SKILL\.md text eol=lf$/m);
});

test('bare invocation drives research, all roles, Chair, report, and drafts', () => {
  assert.match(skill, /## Default invocation/);
  assert.match(skill, /planr operate inspect --json/);
  assert.match(skill, /inspect the workspace first/);
  assert.match(skill, /Never dump a questionnaire/);
  assert.match(skill, /CEO, CTO, CPO, CMO, COO, then/);
  assert.match(skill, /analysisMarkdown/);
  assert.match(skill, /provisional\s+draft paths/);
  assert.match(skill, /dashboard is optional/);
  assert.match(skill, /Stop at review/);
});

test('Codex stays bound to Codex and advisory isolation remains supported', () => {
  assert.match(skill, /runtime: codex/);
  assert.match(skill, /runtimeBinding: required/);
  assert.match(skill, /crossRuntimeFallback: false/);
  assert.match(skill, /assurance: runtime-governed/);
  assert.match(skill, /Codex advisory\s+isolation is supported/);
  assert.match(skill, /Never invoke another vendor runtime/);
  assert.doesNotMatch(skill, /switch to Claude|ask Claude|Claude fallback/i);
});

test('research-first behavior infers cited context without blocking on unknowns', () => {
  assert.match(skill, /Business model, ICP, stage, goals, and metrics\s+may be inferred/);
  assert.match(skill, /find it from the project/);
  assert.match(skill, /continue investigating/);
  assert.match(skill, /Unknown\s+context lowers confidence or opens a gap; it does not block/);
  assert.match(skill, /Connected\/web research requires/);
});

test('the machine lifecycle is hidden and draft authority remains separate', () => {
  // planr-pipeline 0.39.0 (#101) added `heartbeat` and `abandon` to the hidden
  // harness surface. Assert the stable prefix plus the two new verbs rather than
  // the exact pipe-list, so adding a verb upstream does not fail this test while
  // REMOVING one (which would expose machine lifecycle in the public skill, the
  // thing this test guards) still does.
  assert.match(skill, /hides `planr operate harness prepare\|record\|finalize\|resume\|cancel/);
  assert.match(skill, /heartbeat/);
  assert.match(skill, /abandon/);
  assert.match(skill, /Execute only argv arrays in the current handoff/);
  assert.match(skill, /E_OPERATE_DRAFT_UNAPPROVED/);
  assert.match(skill, /cannot enter PLAN or SHIP/);
  assert.doesNotMatch(skill, /planr operate adapter prepare/);
  assert.doesNotMatch(skill, /planr-pipeline\s+operate/);
});
