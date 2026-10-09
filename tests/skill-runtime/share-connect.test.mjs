import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { readSkillSourceRegistry } from '../../packages/skill-runtime/src/catalog.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const flat = (text) => text.replace(/\s+/gu, ' ');
const registry = readSkillSourceRegistry({ repoRoot: root });
const row = (id) => registry.skills.find(({ skillId }) => skillId === id);
const share = flat(read('skills/planr-share/SKILL.md'));
const connect = flat(read('skills/planr-connect/SKILL.md'));
const HOST_TOOL_NAME = /mcp__|search_mcp_registry|suggest_connectors|list_connectors|ToolSearch/u;
const CREDENTIAL_REQUEST = /paste (?:a|your) (?:token|key)|_TOKEN|Bearer|Authorization:/iu;

test('share and connect are user-only; share declares the external-write authority', () => {
  assert.equal(row('planr-share').invocation, 'user-only');
  assert.equal(row('planr-connect').invocation, 'user-only');
  assert.equal(row('planr-share').authorityClass, 'external-write');
  assert.equal(row('planr-connect').authorityClass, 'diagnostic');
  assert.deepEqual(
    registry.skills
      .filter(({ authorityClass }) => authorityClass === 'external-write')
      .map(({ skillId }) => skillId),
    ['planr-share'],
  );
});

test('share previews the text and destination and drafts only after approval', () => {
  assert.match(share, /Show the complete text exactly as it will appear, the destination/u);
  assert.match(share, /create a draft in <destination>; nothing is sent/u);
  assert.match(share, /Create nothing without a clear yes/u);
  assert.match(share, /Never pick a destination yourself/u);
  assert.match(
    share,
    /Send directly only when the user explicitly asks to send and the connection can send/u,
  );
});

test('share without chat prints the update and the host connect step and makes no remote call', () => {
  assert.match(
    share,
    /## With nothing connected Print the update ready to paste and the one connect step for the current host/u,
  );
  assert.match(share, /Make no remote call and do not retry/u);
  assert.match(share, /\[connectors\]\(references\/connectors\.md\)/u);
});

test('connect follows available tool, then connector suggestions, then the host step', () => {
  const available = connect.indexOf('**Already available.**');
  const suggestions = connect.indexOf('**Connector suggestions.**');
  const hostStep = connect.indexOf('**Host step.**');
  assert.ok(available > 0 && available < suggestions && suggestions < hostStep);
  assert.match(connect, /If the host offers a connector-suggestion capability/u);
  assert.match(connect, /wait for the user to connect/u);
  assert.match(connect, /Do not assume any particular tool name/u);
  assert.match(connect, /run `\/planr-connect` again once signed in/u);
});

test('neither skill names host tools, asks for credentials or edits host configuration', () => {
  for (const [name, text] of [
    ['share', share],
    ['connect', connect],
  ]) {
    assert.doesNotMatch(text, HOST_TOOL_NAME, name);
    assert.doesNotMatch(text, CREDENTIAL_REQUEST, name);
    assert.match(text, /Never ask for, read, store or print a token, key or password/u, name);
    assert.match(text, /never edit host configuration|Never edit host configuration/u, name);
  }
});

test('share asks for a project when none is present and treats a chat product as the app', () => {
  const text = flat(read('skills/planr-share/SKILL.md'));
  assert.match(
    text,
    /has no OpenPlanr planning files for the chosen source, say so and ask which project to use, or stop/u,
  );
  assert.match(
    text,
    /When it names a chat product from \[connectors\]\(references\/connectors\.md\) instead, use that product's connection and still ask for the channel or person/u,
  );
});

test('share formats for the connector input when drafting and for pasting otherwise', () => {
  const text = flat(read('skills/planr-share/SKILL.md'));
  assert.match(text, /when drafting through a connector, use the connector's input format/u);
  assert.match(text, /for text the user pastes, use the paste format/u);
});

test('connect resolves a product argument and reports a configured connector awaiting sign-in', () => {
  const source = read('skills/planr-connect/SKILL.md');
  assert.match(source, /^argument-hint: "\[chat\|project-tracker\|source-control\|product\]"$/mu);
  const text = flat(source);
  assert.match(text, /a product name from connectors selects the category it belongs to/u);
  assert.match(
    text,
    /report it as configured but not signed in, tell the user to sign in from the host's connector settings/u,
  );
});
