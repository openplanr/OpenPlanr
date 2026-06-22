import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const errors = [];

for (const plugin of manifest.plugins || []) {
  const row = readme
    .split('\n')
    .find((line) => line.includes(`[\`${plugin.name}\`]`));

  if (!row) {
    errors.push(`README is missing plugin row for ${plugin.name}`);
    continue;
  }

  if (!row.includes(`| ${plugin.version} |`)) {
    errors.push(`README row for ${plugin.name} does not match manifest version ${plugin.version}`);
  }
}

if (!readme.includes('Versions in this README mirror `.claude-plugin/marketplace.json`')) {
  errors.push('README is missing the manifest mirror note');
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('Marketplace README matches .claude-plugin/marketplace.json');
