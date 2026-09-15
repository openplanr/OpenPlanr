#!/usr/bin/env node

import { analyzeSkillGraphImpact } from '../../packages/skill-runtime/src/versioning/index.mjs';

function usage() {
  return 'Usage: npm run skill:impact -- (--module <id> | --host-profile <id> | --host-source <path>) [--json]';
}

function parse(argv) {
  const changes = [];
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') json = true;
    else if (['--module', '--host-profile', '--host-source'].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new TypeError(`${token} requires a value.`);
      index += 1;
      changes.push(token === '--module'
        ? { kind: 'module', id: value }
        : token === '--host-profile'
          ? { kind: 'host-profile', id: value }
          : { kind: 'host-profile', source: value });
    } else if (token === '--help' || token === '-h') return { help: true, changes: [], json };
    else throw new TypeError(`Unknown option: ${token}.`);
  }
  if (changes.length === 0) throw new TypeError('Select at least one module or host profile.');
  return { help: false, changes, json };
}

try {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  const report = analyzeSkillGraphImpact({ repoRoot: process.cwd(), changes: options.changes });
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(`Impact: ${report.affectedSkills.length} skills, ${report.generatedAssets.length} generated assets\n`);
    for (const change of report.changes) {
      process.stdout.write(`  ${change.kind} ${change.id ?? change.source}: ${change.affectedSkills.join(', ')}\n`);
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exit(2);
}
