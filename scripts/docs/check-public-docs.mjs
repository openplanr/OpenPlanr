#!/usr/bin/env node
// Lints the public, human-facing Markdown for content that must not reach readers
// outside the maintainer team: retired commands and repositories, model-provider
// settings the 2.x CLI does not have, personal contacts, internal planning ids,
// stale Node versions, product-name casing, and skill counts that drifted from
// the registry. Exceptions live in public-docs-allowlist.json next to this file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const allowlist = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/docs/public-docs-allowlist.json'), 'utf8'),
);
const registry = JSON.parse(readFileSync(path.join(repoRoot, 'skills/registry.json'), 'utf8'));
const skillCount = registry.skills.length;

// Changelogs are release history; CLAUDE.md and AGENTS.md are generated host guidance.
const HOST_AND_CHANGELOG = (root) => [`${root}/CHANGELOG.md`, `${root}/CLAUDE.md`, `${root}/AGENTS.md`];

const ROOTS = [
  { path: '.', recursive: false, extensions: ['.md'] },
  { path: 'docs', recursive: true, extensions: ['.md'], exclude: ['docs/generated'] },
  { path: '.github', recursive: true, extensions: ['.md', '.yml'], exclude: ['.github/workflows'] },
  { path: 'packages/cli', recursive: false, extensions: ['.md'], exclude: HOST_AND_CHANGELOG('packages/cli') },
  { path: 'packages/cli/docs', recursive: true, extensions: ['.md'] },
  { path: 'packages/pipeline', recursive: false, extensions: ['.md'], exclude: HOST_AND_CHANGELOG('packages/pipeline') },
  { path: 'packages/pipeline/docs', recursive: true, extensions: ['.md'], exclude: ['packages/pipeline/docs/generated'] },
  { path: 'packages/protocol', recursive: false, extensions: ['.md'], exclude: HOST_AND_CHANGELOG('packages/protocol') },
];

const RULES = [
  {
    id: 'retired-command',
    message: 'retired CLI command; skills reason in the host and call only deterministic utilities',
    pattern: /`planr (?:plan|spec decompose)(?:\s|`)|planr pipeline plan|\/planr-pipeline:|\$planr-pipeline:/gu,
  },
  {
    id: 'retired-repository',
    message: 'retired or private repository; link into openplanr/OpenPlanr instead',
    pattern: /github\.com\/openplanr\/(?:planr-pipeline|skills)\b|openplanr-web\b|openplanr-company(?![\w-])/gu,
  },
  {
    id: 'model-provider',
    message: 'the planr CLI and the skills have no model provider; remove provider keys and provider language',
    pattern: /OPENAI_API_KEY|ANTHROPIC_API_KEY|OLLAMA_HOST|\bAI provider\b|--provider\b/gu,
  },
  {
    id: 'email-address',
    message: 'personal contact; only security@openplanr.dev is published',
    pattern: /\b[\w.+-]+@(?!\d|openplanr\.dev\b|users\.noreply\.github\.com\b)[\w-]+\.[\w.-]+\b/gu,
  },
  {
    id: 'internal-identifier',
    message: 'internal planning identifier; public docs describe released behavior only',
    // Identifiers inside code are format examples. In prose, 001, 002, and 900 are the
    // documented example numbers; other bare numbers are roadmap references.
    pattern: /\b(?:BL|ADR|SPEC)-0(?:0[3-9]|[1-8]\d)(?![\w-])/gu,
    prose: true,
  },
  {
    id: 'node-version',
    message: 'only the supported Node.js statement (20 or later; CI on 20, 22, 24) belongs in public docs',
    pattern: /\bNode(?:\.js)? (?:1\d|2[13]|2[5-9]|[3-9]\d)\b/gu,
  },
  {
    id: 'product-name-casing',
    message: 'the product is OpenPlanr and the binary is `planr`; `Planr` is not a name',
    pattern: /(?<![\w/`.-])Planr(?![\w-])/gu,
  },
  {
    id: 'skill-count',
    message: `skill counts must match skills/registry.json (${skillCount})`,
    pattern: /\b(\d{2}) (?:canonical |OpenPlanr )?skills\b/gu,
    accept: (match) => Number(match[1]) === skillCount,
  },
  {
    id: 'hedging-boilerplate',
    message: 'roadmap or hedging language; state what ships today',
    pattern: /\b(?:under development|deferred initiative|does not establish enterprise general availability|no release claim)\b/gu,
  },
];

function listFiles(root) {
  const absolute = path.join(repoRoot, root.path);
  const out = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(repoRoot, full).split(path.sep).join('/');
      if (root.exclude?.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) {
        if (root.recursive && entry.name !== 'node_modules') visit(full);
        continue;
      }
      if (root.extensions.includes(path.extname(entry.name))) out.push(relative);
    }
  };
  if (statSync(absolute).isDirectory()) visit(absolute);
  return out;
}

/** Blank out fenced code blocks and inline code spans, keeping line numbers stable. */
function withoutCode(lines) {
  let fenced = false;
  return lines.map((line) => {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line.replace(/`[^`]*`/gu, '');
  });
}

const files = [...new Set(ROOTS.flatMap(listFiles))].sort();
const findings = [];
for (const file of files) {
  const text = readFileSync(path.join(repoRoot, file), 'utf8');
  const lines = text.split('\n');
  const proseLines = withoutCode(lines);
  for (const rule of RULES) {
    const allowed = allowlist[rule.id] ?? [];
    if (allowed.includes(file)) continue;
    (rule.prose ? proseLines : lines).forEach((line, index) => {
      for (const match of line.matchAll(rule.pattern)) {
        if (rule.ignore?.test(match[0])) continue;
        if (rule.accept?.(match)) continue;
        findings.push(`${file}:${index + 1}: [${rule.id}] "${match[0]}" — ${rule.message}`);
      }
    });
  }
}

const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
if (!new RegExp(`\\b${skillCount} skills\\b`, 'u').test(readme)) {
  findings.push(`README.md: [skill-count] the README must state the current skill count (${skillCount} skills)`);
}

for (const [ruleId, entries] of Object.entries(allowlist)) {
  if (ruleId.startsWith('_')) continue;
  if (!RULES.some((rule) => rule.id === ruleId)) findings.push(`public-docs-allowlist.json: unknown rule ${ruleId}`);
  for (const entry of entries) {
    if (!files.includes(entry)) findings.push(`public-docs-allowlist.json: ${entry} is not a linted file (rule ${ruleId})`);
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  console.error(`\n${findings.length} public documentation finding(s) in ${files.length} files.`);
  process.exit(1);
}
console.log(`Public documentation clean: ${files.length} files, ${RULES.length} rules, ${skillCount} skills.`);
