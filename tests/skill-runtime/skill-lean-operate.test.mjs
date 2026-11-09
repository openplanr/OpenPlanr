import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const skill = readFileSync(resolve(root, 'skills/planr-operate/SKILL.md'), 'utf8');
const flat = skill.replace(/\s+/g, ' ');
const fanOut = skill.indexOf('## Fan out');

test('the default is one agent applying every lens in one pass and writing one report', () => {
  assert.match(flat, /one agent applies all seven lenses in one pass and writes one report/);
  assert.match(flat, /no `\.planr\/`[^.]*chat/);
  assert.ok(fanOut > 0, 'SKILL.md has no fan-out section');
});

test('subagents run only for a named roster or a request for independent reviewers', () => {
  assert.match(flat, /only when the user names a roster or asks for independent reviewers/);
  const defaultPart = skill.slice(0, fanOut);
  assert.doesNotMatch(defaultPart, /Dispatch only the selected independent advisors/);
});

test('cycle, brief and per-lens notes exist only for fan-out or a persisted cycle', () => {
  assert.match(
    flat,
    /`cycle\.md`, `brief\.md` and per-lens notes only when subagents run or the user asks to persist the cycle/,
  );
  const mentions = (text) => (text.match(/`(?:cycle|brief)\.md`/g) ?? []).length;
  assert.equal(mentions(skill.slice(0, fanOut)), 2, 'default section names them once, as the rule');
});

test('the coverage table, decision-changing gaps and source citations stay', () => {
  assert.match(skill, /## Review coverage/);
  assert.match(skill, /## Decision-changing gaps/);
  assert.match(flat, /Every recommendation cites a source/);
  assert.match(skill, /operate-review-quality-contract@2\.0\.0/);
});

test('note validation goes through the checklist, which prefers the CLI on PATH', () => {
  assert.match(skill, /\]\(references\/note-checklist\.md\)/);
  assert.match(flat, /`validate-note` when `command -v openplanr` succeeds/);
  const checklist = readFileSync(resolve(root, 'skills/shared/note-checklist.md'), 'utf8').replace(
    /\s+/g,
    ' ',
  );
  assert.match(
    checklist,
    /`openplanr operate validate-note <note> --profile <profile> --contract-version 2\.0\.0` only if `command -v openplanr` succeeds/,
  );
});

test('the fan-out path keeps the advisor roster, Challenger and Chair', () => {
  const part = skill.slice(fanOut);
  assert.match(part, /Dispatch only the selected independent advisors/);
  for (const lens of ['ceo', 'cto', 'cpo', 'cmo', 'coo', 'challenger', 'chair'])
    assert.match(part, new RegExp(`planr-${lens}-review`));
});

test('SKILL.md stays under its footprint bound', () => {
  assert.ok(Buffer.byteLength(skill) <= 8700, `SKILL.md is ${Buffer.byteLength(skill)} bytes`);
});
