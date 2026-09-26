#!/usr/bin/env node
// Fails when a handwritten source comment cites a planning identifier: a spec, task, story,
// requirement, acceptance-criteria or backlog id, or a numbered hard rule. The sentence after
// such an id is what the comment should say; the id belongs to the commit message and the
// specification. String, template and regex literals are not comments, so ids the product
// generates or parses never count. Exceptions live in source-comments-allowlist.json next to
// this file, as the exact ids a file may mention (format examples, fixture ids).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findCommentIdentifiers,
  RULES,
  SCRIPT_EXTENSIONS,
  STYLE_EXTENSIONS,
} from './lib/source-comments.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowlist = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/source-comments-allowlist.json'), 'utf8'),
);

// The handwritten trees biome.jsonc lints. Generated projections, bundles and recorded
// fixtures are excluded here for the same reason they are excluded there.
const PACKAGE_TREES = ['lib', 'src', 'scripts', 'tests', 'conformance'];
const ROOTS = [
  ...readdirSync(path.join(repoRoot, 'packages')).flatMap((workspace) =>
    PACKAGE_TREES.map((tree) => `packages/${workspace}/${tree}`),
  ),
  'apps/dashboard/src',
  'scripts',
  'tests',
  'conformance',
].filter((root) => existsSync(path.join(repoRoot, root)));

const EXCLUDED_SEGMENTS = new Set(['node_modules', 'generated', 'dist', 'vendor', '__snapshots__']);
const EXCLUDED_PREFIXES = [
  'packages/cli/lib/host-packages',
  'packages/cli/lib/integrations.mjs',
  'packages/cli/lib/integrations.d.mts',
  'packages/cli/tests/e2e/baselines',
  'packages/cli/tests/fixtures',
  'packages/pipeline/conformance/expected',
  'packages/pipeline/conformance/fixtures',
  'packages/pipeline/lib/artifact',
  'packages/pipeline/lib/design',
  'packages/pipeline/lib/design-engine',
  'packages/pipeline/lib/operate',
  'packages/pipeline/lib/protocol',
  'packages/pipeline/scripts/generate-artifact-shell.mjs',
  'packages/pipeline/tests/dashboard/fixtures',
  'packages/pipeline/tests/fixtures',
];

const isExcluded = (relative) =>
  relative.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment)) ||
  EXCLUDED_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));

function listFiles(root) {
  const out = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(repoRoot, full).split(path.sep).join('/');
      if (isExcluded(relative)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      const extension = path.extname(entry.name);
      if (SCRIPT_EXTENSIONS.has(extension) || STYLE_EXTENSIONS.has(extension)) out.push(relative);
    }
  };
  visit(path.join(repoRoot, root));
  return out;
}

const files = [...new Set(ROOTS.flatMap(listFiles))].sort();
const findings = [];
const allowlistUsed = new Set();
const allowlistKey = (rule, file, match) => `${rule}\u0000${file}\u0000${match}`;
for (const file of files) {
  const source = readFileSync(path.join(repoRoot, file), 'utf8');
  for (const finding of findCommentIdentifiers(file, source, path.extname(file))) {
    if ((allowlist[finding.rule]?.[file] ?? []).includes(finding.match)) {
      allowlistUsed.add(allowlistKey(finding.rule, file, finding.match));
      continue;
    }
    findings.push(
      `${file}:${finding.line}: [${finding.rule}] "${finding.match}" — ${finding.message}`,
    );
  }
}

for (const [ruleId, entries] of Object.entries(allowlist)) {
  if (ruleId.startsWith('_')) continue;
  if (!RULES.some((rule) => rule.id === ruleId))
    findings.push(`source-comments-allowlist.json: unknown rule ${ruleId}`);
  for (const [file, matches] of Object.entries(entries)) {
    if (!files.includes(file)) {
      findings.push(
        `source-comments-allowlist.json: ${file} is not a linted file (rule ${ruleId})`,
      );
      continue;
    }
    for (const match of matches) {
      if (!allowlistUsed.has(allowlistKey(ruleId, file, match)))
        findings.push(
          `source-comments-allowlist.json: ${file} no longer mentions "${match}" in a comment (rule ${ruleId})`,
        );
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  console.error(`\n${findings.length} source comment finding(s) in ${files.length} files.`);
  process.exit(1);
}
console.log(`Source comments clean: ${files.length} files, ${RULES.length} rules.`);
