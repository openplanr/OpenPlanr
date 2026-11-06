import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const DESIGN_SKILLS = ['planr-design', 'planr-design-loop', 'planr-design-review'];

const read = (path) => readFileSync(join(root, path), 'utf8');
const prose = (text) => text.replace(/\s+/gu, ' ');
const skill = (id) => read(`skills/${id}/SKILL.md`);
const utilities = (id) => read(`skills/${id}/references/utilities.md`);

/** The probe table row whose first cell matches `signal`. */
function stopRow(text, signal) {
  const rows = text
    .split('\n')
    .filter((line) => line.startsWith('|') && signal.test(line.split('|')[1] ?? ''));
  assert.equal(rows.length, 1, `exactly one probe row matches ${signal}`);
  return rows[0];
}

test('each design skill probes the CLI and the artifact tool before consultation', () => {
  for (const id of DESIGN_SKILLS) {
    const text = prose(skill(id));
    const probe = text.indexOf('openplanr design capabilities --json');
    assert.ok(probe > 0, `${id} runs the capability probe`);
    assert.ok(probe < text.indexOf('(references/discovery.md)'), `${id} probes before consulting`);
    assert.ok(
      text.lastIndexOf('artifact tool', text.indexOf('(references/discovery.md)')) > 0,
      `${id} checks the host artifact tool before consulting`,
    );
    assert.match(
      prose(utilities(id)),
      /Use the `openplanr` on `PATH`; never search for another one or for bundled design scripts\. A failed probe means the matching stop below\./u,
    );
    for (const body of [text, utilities(id)])
      assert.match(
        prose(body),
        /Treat a successful `openplanr design capabilities --json` as proof the runtime is ready\. Never locate or import the OpenPlanr workflow package, inspect `node_modules`, or call internal runtime modules\./u,
      );
  }
});

test('the CLI-missing stop still delivers unverified work and names the install', () => {
  for (const id of DESIGN_SKILLS) {
    const text = utilities(id);
    const row = stopRow(text, /not found/u);
    assert.match(row, /`npm install -g openplanr`/u);
    assert.doesNotMatch(row, /openplanr@latest|--omit/u);
    assert.match(
      prose(text),
      /author `design-document\.json`, its sources and `design-spec\.md`, mark them \*\*unverified\*\*/u,
    );
    assert.match(text, /`\/login`/u, 'Claude Code names sign-in for the hosted canvas');
    assert.match(text, /`\/config`/u, 'Claude Code names re-enabling artifacts');
  }
  assert.match(
    prose(skill('planr-design')),
    /Name both next actions: the stop's command for the local studio and, on Claude Code, `\/login` with a claude\.ai plan for the hosted canvas, or re-enabling artifacts in `\/config`\./u,
  );
});

test('the CLI-too-old stop names the upgrade', () => {
  for (const id of DESIGN_SKILLS) {
    const row = stopRow(utilities(id), /unknown command 'design'/u);
    assert.match(row, /`npm install -g openplanr@latest`/u);
    assert.match(row, /`supported`/u, 'a range without the contract is also too old');
  }
});

test('the CLI-without-workflow-package stop names the reinstall', () => {
  for (const id of DESIGN_SKILLS) {
    const row = stopRow(utilities(id), /E_DESIGN_RUNTIME_MISSING/u);
    assert.match(row, /`npm install -g openplanr`/u);
    assert.match(row, /without `--omit=optional`/u);
  }
});

test('the host table covers Claude Code, Codex, Cursor and ChatGPT', () => {
  for (const id of DESIGN_SKILLS) {
    const text = utilities(id);
    for (const host of [/Claude Code/u, /Codex/u, /Cursor/u, /ChatGPT/u]) stopRow(text, host);
  }
});

test('Loop delivers unverified variants and Review uses hosted canvas comments', () => {
  assert.match(
    prose(skill('planr-design-loop')),
    /every direction's sources and the specification, mark them \*\*unverified\*\*/u,
  );
  const review = prose(skill('planr-design-review'));
  assert.match(review, /> Canvas:/u);
  assert.match(review, /artifact comments tool/u);
  assert.match(
    prose(read('skills/planr-design/references/hosted-canvas.md')),
    /artifact comments tool/u,
  );
});

test('Plan inspects a local handoff through the CLI and names each stop', () => {
  const text = prose(skill('planr-plan'));
  assert.match(text, /`openplanr design handoff <design-document\.json> --action inspect --json`/u);
  for (const action of [
    /`npm install -g openplanr`/u,
    /`npm install -g openplanr@latest`/u,
    /--omit=optional/u,
  ])
    assert.match(text, action);
});
