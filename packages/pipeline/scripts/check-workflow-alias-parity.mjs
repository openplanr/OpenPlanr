#!/usr/bin/env node

// Canonical source-of-truth invariant:
//
//   canonical compiled manifest -> generated host/package projections
//                               -> thin frozen command aliases
//
// A generated skill must contain the canonical skill's behavior. It must never
// replace that behavior with a pointer back to a package command document. The
// command documents are compatibility entrypoints only.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultWorkspaceRoot = resolve(packageRoot, '../..');

export const RUNTIME_DIFFERENTIATED_ALIASES = Object.freeze(new Set());
export const PACKAGE_COMMAND_ALIAS_SLUGS = Object.freeze(new Set(['plan', 'ship']));
export const THIN_ALIAS_LINE_BUDGET = 20;

export const SKILL_PROJECTION_TARGETS = Object.freeze([
  Object.freeze({
    id: 'claude-code',
    path: (skillName) => `adapters/claude-code/skills/${skillName}/SKILL.md`,
  }),
  Object.freeze({
    id: 'codex',
    path: (skillName) => `adapters/codex/skills/${skillName}/SKILL.md`,
  }),
  Object.freeze({
    id: 'cursor',
    path: (skillName) => `adapters/cursor/rules/${skillName}.mdc`,
  }),
  Object.freeze({
    id: 'pipeline',
    path: (skillName) => `packages/pipeline/skills/${skillName}/SKILL.md`,
  }),
  Object.freeze({
    id: 'pipeline-codex',
    path: (skillName) => `packages/pipeline/adapters/codex/skills/${skillName}/SKILL.md`,
  }),
  Object.freeze({
    id: 'pipeline-cursor',
    path: (skillName) => {
      const suffix = skillName.slice('planr-'.length);
      return `packages/pipeline/adapters/cursor/rules/openplanr-${suffix}.mdc`;
    },
  }),
]);

const FORBIDDEN_ALIAS_WORKFLOW = Object.freeze([
  /from the installed pipeline package/iu,
  /planr pipeline (?:prepare-plan|complete-plan|prepare-ship|start-ship|advance-ship|run-ship-gates|finalize-ship)/iu,
  /planning-review/iu,
  /reviewerIds/u,
  /correction\.registered/u,
  /(?:receipt|digest)/iu,
]);

export class WorkflowAliasParityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowAliasParityError';
    this.code = code;
    this.details = details;
  }
}

const canonicalText = (bytes) => String(bytes).replace(/\r\n/gu, '\n');
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function projectionFailures({ skillName, expectedDigest, projectionBytes, projectionId }) {
  if (digest(projectionBytes) === expectedDigest) return [];
  return [
    `${skillName}: ${projectionId} projection differs from the canonical compiled manifest. `
    + 'Regenerate adapters; do not replace canonical behavior with package-command delegation.',
  ];
}

export function thinAliasFailures({ slug, skillName, aliasBytes, label }) {
  const failures = [];
  const text = canonicalText(aliasBytes);
  const lineCount = text.split('\n').length;
  if (lineCount > THIN_ALIAS_LINE_BUDGET) {
    failures.push(
      `${label}: ${lineCount} lines exceeds the thin compatibility-alias budget of `
      + `${THIN_ALIAS_LINE_BUDGET}.`,
    );
  }
  if (!/compatibility alias/iu.test(text)) {
    failures.push(`${label}: must identify itself as a compatibility alias.`);
  }
  if (!text.includes(`skills/${skillName}/SKILL.md`)) {
    failures.push(`${label}: must point to canonical skill skills/${skillName}/SKILL.md.`);
  }
  if (!/alias preserves the canonical workflow without adding runtime-specific logic/iu.test(text)) {
    failures.push(`${label}: must preserve the canonical workflow without adding host behavior.`);
  }
  for (const pattern of FORBIDDEN_ALIAS_WORKFLOW) {
    if (pattern.test(text)) failures.push(`${label}: contains copied workflow machinery (${pattern}).`);
  }
  if (!text.includes(`/planr-pipeline:${slug}`)) {
    failures.push(`${label}: must preserve the frozen /planr-pipeline:${slug} entrypoint.`);
  }
  return failures;
}

function readRequired(path, label, failures) {
  if (!existsSync(path)) {
    failures.push(`${label}: missing ${path}`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

export function checkWorkflowAliasParity({
  projectRoot = packageRoot,
  workspaceRoot = resolve(projectRoot, '../..'),
} = {}) {
  const registryPath = resolve(projectRoot, 'registry/frozen-commands.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  const canonicalManifest = JSON.parse(readFileSync(
    resolve(workspaceRoot, 'adapters/manifests/canonical-skills.json'),
    'utf8',
  ));
  const canonicalById = new Map(canonicalManifest.skills.map((skill) => [skill.id, skill]));
  const failures = [];
  const checked = [];
  let projectionsChecked = 0;
  let aliasesChecked = 0;
  let canonicalSourcesChecked = 0;

  for (const entry of registry.commands) {
    if (!entry.hasSkillAlias) continue;
    const { slug, skillName } = entry;
    if (RUNTIME_DIFFERENTIATED_ALIASES.has(slug)) continue;

    const canonicalRecord = canonicalById.get(skillName);
    if (!canonicalRecord) {
      failures.push(`${skillName}: canonical compiled record is absent from the skill manifest.`);
      continue;
    }
    const canonicalSource = readRequired(
      resolve(workspaceRoot, canonicalRecord.source),
      `${skillName} canonical graph source`,
      failures,
    );
    if (canonicalSource === null) continue;
    if (digest(canonicalSource) !== canonicalRecord.sourceDigest) {
      failures.push(`${skillName}: canonical graph source differs from its manifest digest.`);
      continue;
    }
    canonicalSourcesChecked += 1;

    for (const target of SKILL_PROJECTION_TARGETS) {
      const relativePath = target.path(skillName);
      const bytes = readRequired(
        resolve(workspaceRoot, relativePath),
        `${skillName} ${target.id} projection`,
        failures,
      );
      if (bytes === null) continue;
      const manifestPath = relativePath.startsWith('packages/pipeline/')
        ? relativePath.slice('packages/pipeline/'.length)
        : relativePath;
      const expected = [...canonicalRecord.projections, ...canonicalRecord.packageProjections]
        .find(({ path }) => path === manifestPath || path === relativePath);
      if (!expected) {
        failures.push(`${skillName}: ${target.id} projection is absent from the canonical manifest.`);
        continue;
      }
      failures.push(...projectionFailures({
        skillName,
        expectedDigest: expected.digest,
        projectionBytes: bytes,
        projectionId: target.id,
      }));
      projectionsChecked += 1;
    }

    const frozenAliasPath = resolve(workspaceRoot, `adapters/claude-code/commands/${slug}.md`);
    const frozenAlias = readRequired(frozenAliasPath, `${slug} frozen Claude alias`, failures);
    if (frozenAlias !== null) {
      failures.push(...thinAliasFailures({
        slug,
        skillName,
        aliasBytes: frozenAlias,
        label: `adapters/claude-code/commands/${slug}.md`,
      }));
      aliasesChecked += 1;
    }

    if (PACKAGE_COMMAND_ALIAS_SLUGS.has(slug)) {
      const commandPath = resolve(projectRoot, `commands/${slug}.md`);
      const command = readRequired(commandPath, `${slug} package command alias`, failures);
      if (command !== null) {
        failures.push(...thinAliasFailures({
          slug,
          skillName,
          aliasBytes: command,
          label: `commands/${slug}.md`,
        }));
        aliasesChecked += 1;
      }
    }
    checked.push(slug);
  }

  if (failures.length) {
    throw new WorkflowAliasParityError(
      'E_WORKFLOW_ALIAS_PARITY',
      `Workflow alias parity check failed:\n${failures.map((failure) => `  - ${failure}`).join('\n')}`,
      { failures },
    );
  }
  return { ok: true, checked, canonicalSourcesChecked, projectionsChecked, aliasesChecked };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkWorkflowAliasParity({ workspaceRoot: defaultWorkspaceRoot });
    process.stdout.write(
      `Workflow alias parity OK (${result.checked.join(', ')}; `
      + `${result.projectionsChecked} projections; ${result.aliasesChecked} aliases).\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.code ?? 'E_WORKFLOW_ALIAS_PARITY'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
