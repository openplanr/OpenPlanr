#!/usr/bin/env node

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectedSkillName } from './host-invocations.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function filesBelow(relativeRoot) {
  const directory = join(root, relativeRoot);
  if (!existsSync(directory)) return [];
  const result = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        throw new Error(`Runtime surface contains a symlink: ${relative(root, absolute)}`);
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  };
  visit(directory);
  return result.sort();
}

const cliManifest = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'));
const dependencyNames = Object.keys({
  ...cliManifest.dependencies,
  ...cliManifest.optionalDependencies,
  ...cliManifest.devDependencies,
});
const providerPackages = dependencyNames.filter((name) => (
  name === 'openai' || name === '@anthropic-ai/sdk' || /ollama/iu.test(name)
));
if (providerPackages.length > 0) {
  throw new Error(`CLI still depends on model providers: ${providerPackages.join(', ')}`);
}

const cliSources = filesBelow('packages/cli/src').filter((path) => ['.ts', '.mts', '.js', '.mjs'].includes(extname(path)));
const providerPatterns = [
  /from\s+['"](?:openai|@anthropic-ai\/sdk|[^'"]*ollama[^'"]*)['"]/iu,
  /\b(?:getAIProvider|generateStreamingJSON|AnthropicProvider|OpenAIProvider|OllamaProvider)\b/u,
  /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/u,
];
for (const path of cliSources) {
  const bytes = readFileSync(path, 'utf8');
  const match = providerPatterns.find((pattern) => pattern.test(bytes));
  if (match) throw new Error(`CLI provider purity failed in ${relative(root, path).split(sep).join('/')}: ${match}`);
}

const semanticPatterns = [
  /`planr\s+plan(?:\s|`)/iu,
  /`planr\s+spec\s+decompose(?:\s|`)/iu,
  /`planr-pipeline(?:\s|`)/iu,
  /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/u,
  /\b(?:anthropic|openai|ollama)\s+(?:client|provider|model)\b/iu,
];
let semanticFiles = 0;
for (const skillId of ['planr-plan', 'planr-spec', 'planr-ship', 'planr-design', 'planr-design-loop', 'planr-design-review']) {
  const hostSkillName = projectedSkillName(skillId);
  for (const skillRoot of [
    `skills/${skillId}`,
    `dist/plugins/openai/openplanr/skills/${hostSkillName}`,
    `dist/plugins/claude/openplanr/skills/${hostSkillName}`,
    `dist/plugins/cursor/openplanr/rules/${skillId}`,
  ]) {
    for (const path of filesBelow(skillRoot)) {
      if (!['.md', '.mdc', '.mjs', '.js', '.json', '.yaml', '.css', '.html'].includes(extname(path))) continue;
      semanticFiles += 1;
      const bytes = readFileSync(path, 'utf8');
      const match = semanticPatterns.find((pattern) => pattern.test(bytes));
      if (match) throw new Error(`Semantic runtime purity failed in ${relative(root, path).split(sep).join('/')}: ${match}`);
    }
  }
}

for (const host of ['openai', 'claude']) {
  for (const skillId of ['planr-plan', 'planr-spec', 'planr-ship']) {
    const bytes = readFileSync(join(root, `dist/plugins/${host}/openplanr/skills/${projectedSkillName(skillId)}/SKILL.md`), 'utf8');
    if (/\bopenplanr:planr-|(?:\/|\$)planr-[a-z]/u.test(bytes)) {
      throw new Error(`${host}/${skillId} contains a legacy long invocation.`);
    }
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cliSourceFiles: cliSources.length,
  providerDependencies: 0,
  providerCalls: 0,
  semanticSkillFiles: semanticFiles,
  semanticSubprocesses: 0,
}, null, 2)}\n`);
