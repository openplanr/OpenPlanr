import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const flat = (path) => read(path).replace(/\s+/g, ' ');
const plan = flat('skills/planr-plan/SKILL.md');
const spec = flat('skills/planr-spec/SKILL.md');

test('Plan without .planr/ returns the decomposition in chat or one existing-convention file', () => {
  assert.match(plan, /When the repository has no `\.planr\/`/);
  assert.match(
    plan,
    /return the decomposition in chat or in one file where the repository keeps such documents/,
  );
  assert.match(plan, /unless the request implies follow-on implementation/);
  assert.match(
    plan,
    /With `\.planr\/`, or when implementation follows, use the full planning contract/,
  );
});

test('minimal Plan output keeps splitting, dependsOn and acceptance mapping', () => {
  assert.match(
    plan,
    /skip frontmatter and the ID procedure; task splitting, `dependsOn` and mapping every acceptance item to a task still apply/,
  );
  assert.doesNotMatch(plan, /design-lineage|planning-lineage helper/);
});

test('Plan references an existing specification and never copies it', () => {
  assert.match(plan, /never copy an existing specification into `\.planr\/specs\/`/i);
  assert.match(plan, /reference its path/);
});

test('Gherkin files are written only on request', () => {
  assert.match(plan, /Write Gherkin `\.feature` files only when the user asks/);
  const layout = read('skills/planr-plan/references/artifact-contract.md').match(
    /```text\n([\s\S]*?)```/,
  )[1];
  assert.doesNotMatch(layout, /gherkin/);
});

test('design handoff reading lives in the reference and applies only when a design exists', () => {
  assert.doesNotMatch(
    plan,
    /design-document\.json|studio-state|review-handoff\.json|finalized\.json/,
  );
  assert.match(
    plan,
    /When a design exists[^.]*\[the design handoff contract\]\(references\/design-handoff\.md\)/,
  );
  const reference = read('skills/planr-plan/references/design-handoff.md');
  for (const needle of [
    'design-document.json',
    '.design/studio-state.json',
    '`selectedVariant`',
    'openplanr design handoff <design-document.json> --action inspect --json',
    'E_DESIGN_RUNTIME_MISSING',
    'finalized.json',
  ]) {
    assert.ok(reference.includes(needle), `design-handoff.md lacks ${needle}`);
  }
});

test('Plan keeps ID allocation, acceptance coverage, task splitting and dependsOn rules', () => {
  assert.match(plan, /\[the planning ID procedure\]\(references\/planning-ids\.md\)/);
  assert.match(plan, /Map every acceptance ID through `acceptanceRefs`/);
  assert.match(plan, /Separate by ownership first/);
  assert.match(plan, /Set `dependsOn` only when a task consumes another task's output/);
  assert.match(plan, /check directly that every story and task frontmatter is valid/);
});

test('Spec without .planr/ writes where the repository already keeps specifications', () => {
  assert.match(
    spec,
    /When the repository has no `\.planr\/`, write the specification where it already keeps specifications/,
  );
  assert.match(spec, /Assumption:/);
  assert.match(spec, /Requirements and acceptance criteria must be observable/);
});

test('Spec validates with the CLI only under .planr/', () => {
  assert.match(
    spec,
    /when the specification is under `\.planr\/` and `command -v openplanr` succeeds/,
  );
  assert.match(
    read('skills/planr-spec/references/specification-contract.md').replace(/\s+/g, ' '),
    /When the repository has no `\.planr\/`, write the specification where it already keeps specifications/,
  );
});

test('plan and spec stay lean', () => {
  assert.ok(Buffer.byteLength(read('skills/planr-plan/SKILL.md')) <= 7000);
  assert.ok(Buffer.byteLength(read('skills/planr-spec/SKILL.md')) <= 3600);
});
