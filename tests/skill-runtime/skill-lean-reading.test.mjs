import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const SKILLS = ['spec', 'plan', 'plan-review', 'operate', 'ship', 'release'];
const skillText = (name) => read(`skills/planr-${name}/SKILL.md`);

test('each lean skill reads named files plus tracked instructions in one batch', () => {
  for (const name of SKILLS) {
    const text = skillText(name);
    assert.match(text, /\bin one\s+batch\b/, name);
    assert.match(text, /`AGENTS\.md`/, name);
    assert.match(text, /`CLAUDE\.md`/, name);
    assert.match(text, /named\s+gap/, name);
  }
});

test('no lean skill lists categories of documents to read', () => {
  for (const name of SKILLS) {
    assert.doesNotMatch(skillText(name), /ADRs, product documentation/, name);
    assert.doesNotMatch(skillText(name), /repository instructions, ADRs/, name);
  }
});

test('every lean skill links the one shared return reference', () => {
  const shared = read('skills/shared/return-contract.md');
  for (const name of SKILLS) {
    assert.match(skillText(name), /\]\(references\/return-contract\.md\)/, name);
    assert.equal(read(`skills/planr-${name}/references/return-contract.md`), shared, name);
    const manifest = JSON.parse(read(`skills/planr-${name}/openplanr.skill.json`));
    assert.ok(
      manifest.resources.some(({ path }) => path === 'references/return-contract.md'),
      `${name} manifest lacks the return contract`,
    );
  }
});

test('the return rules are not repeated in the skills', () => {
  for (const name of SKILLS) {
    assert.doesNotMatch(
      skillText(name),
      /never require another|requires another|another planning run|corrective review/i,
      name,
    );
  }
});

test('Spec and Plan name the validation command instead of an unnamed helper', () => {
  for (const name of ['spec', 'plan']) {
    const text = skillText(name);
    assert.doesNotMatch(text, /If a helper is unavailable/, name);
    assert.match(text, /`openplanr spec validate <SPEC-ID>`/, name);
  }
});
