import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'));
const ecosystem = JSON.parse(readFileSync(new URL('../ecosystem.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
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

const pipelinePlugin = manifest.plugins?.find((plugin) => plugin.name === 'planr-pipeline');
const skillsPlugin = manifest.plugins?.find((plugin) => plugin.name === 'openplanr');
if (pipelinePlugin?.version !== ecosystem.components?.pipeline?.version) {
  errors.push('Pipeline plugin version does not match ecosystem.json');
}
if (skillsPlugin?.version !== ecosystem.components?.skills?.version) {
  errors.push('Skills plugin version does not match ecosystem.json');
}
if (packageJson.version !== ecosystem.components?.marketplace?.version) {
  errors.push('Marketplace package version does not match ecosystem.json');
}
for (const adapter of ecosystem.adapters ?? []) {
  if (
    adapter.version !== ecosystem.components.pipeline.version ||
    adapter.pipelineRange !== ecosystem.components.cli.pipelineRange
  ) {
    errors.push(`Adapter ${adapter.runtime} is not aligned with the pipeline release`);
  }
}

if (!readme.includes('Versions in this README mirror `.claude-plugin/marketplace.json`')) {
  errors.push('README is missing the manifest mirror note');
}
if (!readme.includes('planr artifact') || !readme.includes('share.openplanr.dev')) {
  errors.push('README is missing artifact-review and private-share guidance');
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('Marketplace README matches .claude-plugin/marketplace.json');
