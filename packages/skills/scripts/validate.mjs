import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const names = new Set();
const errors = [];

for (const plugin of marketplace.plugins ?? []) {
  for (const relative of plugin.skills ?? []) {
    const skillPath = join(root, relative, 'SKILL.md');
    if (!existsSync(skillPath)) {
      errors.push(`Missing skill: ${relative}`);
      continue;
    }
    const text = readFileSync(skillPath, 'utf8');
    const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    if (!name) errors.push(`${relative} has no frontmatter name`);
    else if (names.has(name)) errors.push(`Duplicate skill name: ${name}`);
    else names.add(name);
    if (/CLAUDE_PLUGIN_ROOT|Sonnet|Opus|persona role-shift/.test(text)) {
      errors.push(`${relative} contains a runtime-specific portable-workflow leak`);
    }
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
  process.exit(1);
}
process.stdout.write(`PASS ${names.size} portable skills validated\n`);
