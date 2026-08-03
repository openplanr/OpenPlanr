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
  // The hidden-lifecycle action list grows as the contract gains actions
  // (heartbeat, abandon, ...). Pin the claim and the core actions, not the tail,
  // so adding a governed action does not falsely read as a regression.
  assert.match(skill, /hides `planr operate harness prepare\|record\|finalize\|resume\|cancel/);
  assert.match(skill, /Execute only argv arrays in the current handoff/);
  assert.match(skill, /E_OPERATE_DRAFT_UNAPPROVED/);
  assert.match(skill, /cannot enter PLAN or SHIP/);
  assert.doesNotMatch(skill, /planr operate adapter prepare/);
  assert.doesNotMatch(skill, /planr-pipeline\s+operate/);
});

test('a lens that never returns has a governed terminal path and an operator escape', () => {
  // A stalled lens must not strand the cycle. The runtime terminates it while it
  // holds the lease; if the runtime itself dies, the operator escape must still
  // reach a reviewable cycle without discarding recorded work.
  assert.match(skill, /harness abandon --role/);
  assert.match(skill, /not_evaluated/);
  assert.match(skill, /planr operate cycles abandon-role/);
  assert.match(skill, /lease has lapsed/);
  assert.match(skill, /never infer it/);
  // Chair must still refuse to invent the missing lens's conclusions, and the
  // runtime must be told never to manufacture one in its place.
  assert.match(skill, /never synthesize a missing lens's conclusions/);
  assert.match(skill, /Never fabricate\s+a result for a lens that did not return/);
});

const advisor = readFileSync(join(skillRoot, 'references', 'advisor.md'), 'utf8');

test('each advisor result records the instant its role returns, never a batch barrier (FR1)', () => {
  // Skill dispatch step: per-role immediate recording, no sibling wait, no strand.
  assert.match(skill, /record each result the instant that role\s+returns/);
  assert.match(skill, /but never waiting on\s+a sibling first/);
  assert.match(skill, /a slow lens cannot strand a finished one/);
  // Advisor procedure: recorded on return, independent of siblings, never held
  // back for the whole board, and a retry replays identical bytes.
  assert.match(advisor, /recorded the instant you return, independent of any\s+sibling lens/);
  assert.match(advisor, /never held back for the whole board to finish/);
  assert.match(advisor, /replays\s+identical bytes for the same role and idempotency key/);
  // Neither asset keeps a batch / whole-board recording barrier.
  for (const asset of [skill, advisor]) {
    assert.doesNotMatch(asset, /record (?:results|their exact results) serially/i);
    assert.doesNotMatch(asset, /wait for all/i);
  }
});

test('a still-running role renews via the harness heartbeat action (FR2)', () => {
  assert.match(skill, /issue `harness heartbeat` to renew the session/);
  assert.match(skill, /rather\s+than let it expire/);
});

test('the thin workflow names harness actions but reimplements no engine bookkeeping (FR3)', () => {
  for (const asset of [skill, advisor]) {
    // No concrete lease/heartbeat/retry durations — timing lives in the engine.
    assert.doesNotMatch(asset, /\b\d+\s*(?:ms|milliseconds?|seconds?|minutes?|hours?)\b/i);
    // Machine fields are preserved byte-for-byte, never recomputed in prose.
    assert.doesNotMatch(asset, /\b(?:re)?compute|calculate\b/i);
    // No retry-budget or attempt-counter arithmetic embedded in the workflow.
    assert.doesNotMatch(asset, /retry (?:budget|count|counter|attempts?)\s*(?:of|=|is)?\s*\d+/i);
  }
});
