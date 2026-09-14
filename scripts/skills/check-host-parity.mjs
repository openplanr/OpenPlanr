#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST_PLUGIN_NAME, projectedSkillName, renderNamespacedSkill } from './host-invocations.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const canonical = JSON.parse(readFileSync(join(root, 'adapters/manifests/canonical-skills.json'), 'utf8'));
const roles = JSON.parse(readFileSync(join(root, 'adapters/manifests/role-assets.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(root, 'skills/registry.json'), 'utf8'));
const skillIds = canonical.skillIds;
const expectedSkillIds = registry.skills.map(({ skillId }) => skillId);
const expectedHostSkillNames = expectedSkillIds.map(projectedSkillName);

function read(path) {
  return readFileSync(join(root, path), 'utf8').replace(/\r\n/gu, '\n');
}

function subdirectories(path) {
  return readdirSync(join(root, path), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

if (canonical.protocolVersion !== '1.8.0' || canonical.sourceFormat !== 'package-v1') {
  throw new Error('Canonical skill custody must use Protocol 1.8 package-v1 sources.');
}
if (JSON.stringify(skillIds) !== JSON.stringify(expectedSkillIds) || canonical.aliases.length !== 0) {
  throw new Error('Host parity requires registry-exact canonical skills and no aliases.');
}

for (const host of ['openai', 'claude']) {
  const pluginRoot = `dist/plugins/${host}/openplanr`;
  const installed = subdirectories(`${pluginRoot}/skills`);
  if (JSON.stringify(installed) !== JSON.stringify([...expectedHostSkillNames].sort())) {
    throw new Error(`${host} skill membership differs from the canonical catalog.`);
  }
  for (const skillId of skillIds) {
    const hostSkillName = projectedSkillName(skillId);
    const skill = canonical.skills.find(({ id }) => id === skillId);
    const source = skill?.entrypoint;
    if (!source || renderNamespacedSkill(read(source), skillId) !== read(`${pluginRoot}/skills/${hostSkillName}/SKILL.md`)) {
      throw new Error(`${host}/${skillId} does not preserve its canonical namespaced skill projection.`);
    }
    const resourceHost = host === 'openai' ? 'codex' : 'claude-code';
    for (const resource of skill.resources.filter(({ hosts }) => hosts.includes(resourceHost))) {
      if (host === 'openai' && resource.path === 'agents/openai.yaml') continue;
      const installed = join(root, pluginRoot, 'skills', hostSkillName, resource.path);
      const original = join(root, 'skills', skillId, resource.path);
      if (!existsSync(installed) || !readFileSync(original).equals(readFileSync(installed))) {
        throw new Error(`${host}/${skillId}/${resource.path} does not preserve its canonical resource bytes.`);
      }
    }
  }
  for (const obsolete of ['commands', 'codex-skills']) {
    if (existsSync(join(root, pluginRoot, obsolete))) {
      throw new Error(`${pluginRoot}/${obsolete} is an obsolete duplicate surface.`);
    }
  }
}

for (const [host, manifestPath] of [
  ['openai', 'dist/plugins/openai/openplanr/.codex-plugin/plugin.json'],
  ['claude', 'dist/plugins/claude/openplanr/.claude-plugin/plugin.json'],
]) {
  const manifest = JSON.parse(read(manifestPath));
  if (manifest.name !== HOST_PLUGIN_NAME) throw new Error(`${host} plugin must expose the ${HOST_PLUGIN_NAME} namespace.`);
  for (const skillId of skillIds) {
    const bytes = read(`dist/plugins/${host}/openplanr/skills/${projectedSkillName(skillId)}/SKILL.md`);
    if (!new RegExp(`^name: ${projectedSkillName(skillId)}$`, 'mu').test(bytes)) {
      throw new Error(`${host}/${skillId} does not expose its short host name.`);
    }
  }
}

const actualAgentFiles = readdirSync(join(root, 'dist/plugins/claude/openplanr/agents'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name)
  .sort();
if (actualAgentFiles.length !== 9 || roles.roleIds.length !== 9) {
  throw new Error(`Claude agent parity requires nine roles; found ${actualAgentFiles.length}.`);
}

const cursorRules = readdirSync(join(root, 'dist/plugins/cursor/openplanr/rules'), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mdc'))
  .map((entry) => entry.name.slice(0, -4))
  .sort();
if (JSON.stringify(cursorRules) !== JSON.stringify([...skillIds].sort())) {
  throw new Error('Cursor rule membership differs from the canonical catalog.');
}

for (const skill of canonical.skills) {
  for (const resource of skill.resources.filter(({ hosts }) => hosts.includes('cursor'))) {
    const installed = join(root, 'dist/plugins/cursor/openplanr/rules', skill.id, resource.path);
    const original = join(root, 'skills', skill.id, resource.path);
    if (!existsSync(installed) || !readFileSync(original).equals(readFileSync(installed))) {
      throw new Error(`cursor/${skill.id}/${resource.path} does not preserve its canonical resource bytes.`);
    }
  }
}

for (const generatedRoot of [
  'dist/plugins/openai/openplanr',
  'dist/plugins/claude/openplanr',
  'dist/plugins/cursor/openplanr',
]) {
  if (lstatSync(join(root, generatedRoot)).isSymbolicLink()) {
    throw new Error(`${generatedRoot} must be a self-contained directory, not a symlink.`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  protocolVersion: '1.8.0',
  skills: skillIds.length,
  claudeAgents: actualAgentFiles.length,
  hosts: ['openai', 'claude', 'cursor'],
  aliases: 0,
  generatedCommands: 0,
}, null, 2)}\n`);
