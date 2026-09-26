#!/usr/bin/env node

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMarkdownAsset } from '../../packages/skill-runtime/src/compiler/index.mjs';
import { linkSkillProjection } from '../../packages/skill-runtime/src/linker/index.mjs';
import { projectedSkillName } from './host-invocations.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const pluginRoot = resolve(root, 'dist/plugins/openai/openplanr');
const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(root, 'skills/registry.json'), 'utf8'));
if (manifest.name !== 'planr' || manifest.skills !== './skills/')
  throw new Error('Invalid OpenAI plugin manifest.');
const skillIds = readdirSync(join(pluginRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const canonicalByProjectedName = new Map(
  registry.skills.map(({ skillId }) => [projectedSkillName(skillId), skillId]),
);
const expectedSkillNames = [...canonicalByProjectedName.keys()].sort();
if (JSON.stringify(skillIds) !== JSON.stringify(expectedSkillNames)) {
  throw new Error(
    `OpenAI skill membership differs from the ${expectedSkillNames.length}-skill canonical registry.`,
  );
}
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink())
      throw new Error(`Plugin contains a symlink: ${relative}`);
    if (entry.isDirectory()) return files(absolute, relative);
    return [{ path: relative, bytes: readFileSync(absolute, 'utf8') }];
  });
}
for (const hostSkillName of skillIds) {
  const skillId = canonicalByProjectedName.get(hostSkillName);
  if (!skillId) throw new Error(`OpenAI plugin contains unknown skill directory ${hostSkillName}.`);
  const members = files(join(pluginRoot, 'skills', hostSkillName));
  const primary = members.find(({ path }) => path === 'SKILL.md');
  const metadata = members.find(({ path }) => path === 'agents/openai.yaml');
  const packageManifest = members.find(({ path }) => path === 'openplanr.skill.json');
  if (!primary || !metadata || !packageManifest)
    throw new Error(`${skillId} is not a complete standard skill package.`);
  parseMarkdownAsset(primary.bytes, { expectedName: hostSkillName });
  linkSkillProjection({
    skillId,
    host: 'codex',
    primary,
    references: members.filter(({ path }) => path.startsWith('references/')),
    auxiliary: members.filter(({ path }) => path !== 'SKILL.md' && !path.startsWith('references/')),
  });
  if (!metadata.bytes.includes(`$planr:${hostSkillName}`))
    throw new Error(`${skillId} lacks native OpenAI invocation metadata.`);
}
process.stdout.write(`OpenAI plugin content PASS: ${skillIds.length} canonical skills.\n`);
