import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { parseFrontmatter, splitFrontmatter } from '../dashboard/graph-reader.mjs';
import { validateProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

export const PROFESSIONAL_SPECIFICATION_CONTRACT = 'professional-specification@1.0.0';
export const MANDATORY_PLANNING_REVIEWERS = Object.freeze([
  'direction-reviewer',
  'engineering-reviewer',
  'design-reviewer',
  'devex-reviewer',
]);
export const PLANNING_REVIEW_SPECIALISTS = Object.freeze([
  'security',
  'performance',
  'migration',
  'api-contract',
  'data-integrity',
]);

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function posix(value) {
  return value.split(sep).join('/');
}

function normalizePlanningBytes(path, bytes) {
  if (!/\.(?:md|feature)$/i.test(path)) return Buffer.from(bytes);
  const lines = Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n').split('\n');
  let definitionOfDone = false;
  const task = /(?:^|\/)(?:T-|task-)[^/]*\.md$/i.test(path);
  return Buffer.from(
    lines
      .flatMap((line) => {
        if (/^(?:status|updated|kanbanosId|contentHash):\s*/.test(line)) return [];
        if (/^#{1,4}\s+/.test(line))
          definitionOfDone = task && /^#{2,4}\s+Definition of done\s*$/i.test(line.trim());
        return [definitionOfDone ? line.replace(/^(\s*-\s+)\[[ xX]\]/, '$1[_]') : line];
      })
      .join('\n'),
    'utf8',
  );
}

function safeFiles(root, current = root, output = []) {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (['.ship', '.plan-review'].includes(entry.name)) continue;
    const absolute = join(current, entry.name);
    const path = posix(relative(root, absolute));
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink())
      fail('E_PLAN_REVIEW_STORAGE_UNSAFE', `Planning artifact ${path} is a symlink.`);
    if (stat.isDirectory()) safeFiles(root, absolute, output);
    else if (
      stat.isFile() &&
      !['.gitkeep', 'qa-report.md', '.pipeline-shipped', '.run-manifest.jsonl'].includes(entry.name)
    )
      output.push({ path, absolute });
  }
  return output;
}

function section(body, title) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const index = lines.findIndex((line) =>
    new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(
      line.trim(),
    ),
  );
  if (index < 0) return '';
  const result = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^##\s+/.test(lines[cursor])) break;
    result.push(lines[cursor]);
  }
  return result.join('\n').trim();
}

function subsection(text, title) {
  const lines = text.split('\n');
  const index = lines.findIndex((line) =>
    new RegExp(`^###\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(
      line.trim(),
    ),
  );
  if (index < 0) return '';
  const result = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (/^###\s+/.test(lines[cursor])) break;
    result.push(lines[cursor]);
  }
  return result.join('\n').trim();
}

function listItems(text) {
  return text.split('\n').flatMap((line) => {
    const match = line.match(/^\s*-\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
    return match ? [match[1].trim()] : [];
  });
}

function labeled(text, label) {
  const pattern = new RegExp(
    `^\\s*(?:-\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`,
    'im',
  );
  return text.match(pattern)?.[1]?.trim() ?? '';
}

function nonPlaceholder(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /(?:\bTODO\b|\bTBD\b|\.\.\.|\[[^\]]+\])/i.test(normalized)) {
    fail('E_PROFESSIONAL_SPEC_INCOMPLETE', `${label} is missing or contains a placeholder.`);
  }
  return normalized;
}

function explicitItems(text, label, { allowNone = false } = {}) {
  const items = listItems(text).filter((item) => !/^_?(?:none|nothing)\b/i.test(item));
  if (items.length)
    return items.map((item, index) => nonPlaceholder(item, `${label} ${index + 1}`));
  if (allowNone && /\b(?:none|no constraints)\b/i.test(text)) return [];
  fail('E_PROFESSIONAL_SPEC_INCOMPLETE', `${label} must be explicitly declared.`);
}

function deriveProfessionalSpecification({ spec, mode, slug }) {
  const bytes = normalizePlanningBytes(spec.path, readFileSync(spec.absolute));
  const { raw, body } = splitFrontmatter(bytes.toString('utf8'));
  const frontmatter = parseFrontmatter(raw);
  if (frontmatter.specificationContract !== PROFESSIONAL_SPECIFICATION_CONTRACT) {
    fail(
      'E_PROFESSIONAL_SPEC_REQUIRED',
      `New planning review requires specificationContract: "${PROFESSIONAL_SPECIFICATION_CONTRACT}".`,
      'Run planr-spec and review the decision-complete specification before starting plan review.',
    );
  }
  const audienceText = section(body, 'Audience');
  const outcomeText = section(body, 'Outcome & Measurement');
  const constraintsText = section(body, 'Constraints');
  const evidenceText = section(body, 'Evidence Expectations');
  const failureText = section(body, 'Failure Modes');
  const rollbackText = section(body, 'Rollback');
  const scopeText = section(body, 'Scope Boundaries');
  const acceptanceText = section(body, 'Acceptance Criteria');
  const evidenceExpectations = explicitItems(evidenceText, 'Evidence expectation');
  const acceptanceCriteria = explicitItems(acceptanceText, 'Acceptance criterion').map(
    (statement, index) => {
      if (!/\bgiven\b[\s\S]*\bwhen\b[\s\S]*\bthen\b/i.test(statement)) {
        fail(
          'E_PROFESSIONAL_SPEC_INCOMPLETE',
          `Acceptance criterion ${index + 1} must be decision-complete Given/When/Then.`,
        );
      }
      return { id: `AC-${index + 1}`, statement, evidence: evidenceExpectations.join('; ') };
    },
  );
  const constraints = explicitItems(constraintsText, 'Constraint', { allowNone: true });
  const declaredSpecialists = Array.isArray(frontmatter.review_specialists)
    ? frontmatter.review_specialists
    : [];
  const orderedSpecialists = PLANNING_REVIEW_SPECIALISTS.filter((id) =>
    declaredSpecialists.includes(id),
  );
  if (
    declaredSpecialists.length !== orderedSpecialists.length ||
    JSON.stringify(declaredSpecialists) !== JSON.stringify(orderedSpecialists)
  ) {
    fail(
      'E_PLAN_REVIEW_REVIEWER_INVALID',
      'review_specialists must contain only declared specialist IDs in canonical registry order.',
    );
  }
  const sourceDigest = digestBytes(bytes);
  const projection = {
    kind: 'professional-specification',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    source: {
      mode,
      featureId: nonPlaceholder(frontmatter.id, 'Specification id'),
      slug,
      title: nonPlaceholder(frontmatter.title, 'Specification title'),
    },
    audience: {
      primary: nonPlaceholder(
        labeled(audienceText, 'Primary') ||
          audienceText.split('\n').find((line) => line.trim() && !line.trim().startsWith('-')),
        'Primary audience',
      ),
      affected: listItems(audienceText).filter((item) => !/^primary\s*:/i.test(item)),
    },
    outcome: {
      statement: nonPlaceholder(labeled(outcomeText, 'Outcome'), 'Outcome'),
      measure: nonPlaceholder(labeled(outcomeText, 'Measure'), 'Outcome measure'),
      target: nonPlaceholder(labeled(outcomeText, 'Target'), 'Outcome target'),
      timeframe: nonPlaceholder(labeled(outcomeText, 'Timeframe'), 'Outcome timeframe'),
    },
    constraints: { status: constraints.length ? 'declared' : 'none', items: constraints },
    evidenceExpectations,
    failureModes: explicitItems(failureText, 'Failure mode'),
    rollback: {
      trigger: nonPlaceholder(labeled(rollbackText, 'Trigger'), 'Rollback trigger'),
      strategy: nonPlaceholder(labeled(rollbackText, 'Strategy'), 'Rollback strategy'),
      verification: nonPlaceholder(labeled(rollbackText, 'Verification'), 'Rollback verification'),
    },
    scope: {
      inScope: explicitItems(subsection(scopeText, 'In Scope'), 'In-scope boundary'),
      outOfScope: explicitItems(subsection(scopeText, 'Out of Scope'), 'Out-of-scope boundary'),
    },
    acceptanceCriteria,
    declaredSpecialists: orderedSpecialists,
    decisionComplete: true,
    sourceDigest,
  };
  projection.digest = sha256Jcs(projection);
  return assertProfessionalSpecification(projection);
}

export function assertProfessionalSpecification(value) {
  const errors = validateProtocolArtifact('professional-specification', value, {
    protocolVersion: '1.1.0',
  });
  if (errors.length) fail('E_PROFESSIONAL_SPEC_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  const withoutDigest = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'digest'),
  );
  if (value.digest !== sha256Jcs(withoutDigest))
    fail(
      'E_PROFESSIONAL_SPEC_INVALID',
      'Professional specification digest does not bind its exact projection.',
    );
  return value;
}

function specFile(featureRoot, mode) {
  const candidates = safeFiles(featureRoot).filter(({ path }) =>
    mode === 'spec-driven'
      ? /(?:^|\/)SPEC-[^/]+\.md$/i.test(path)
      : /(?:^|\/)spec-[^/]+\.md$/i.test(path),
  );
  if (candidates.length !== 1)
    fail(
      'E_PROFESSIONAL_SPEC_REQUIRED',
      'Planning review requires exactly one canonical specification artifact.',
    );
  return { ...candidates[0], root: featureRoot };
}

function taskGraph(featureRoot, files) {
  return files
    .filter(
      ({ path }) => /(?:^|\/)(?:T-|task-)[^/]+\.md$/i.test(path) && !/error-report/i.test(path),
    )
    .map(({ path, absolute }) => {
      const { raw } = splitFrontmatter(readFileSync(absolute, 'utf8'));
      const frontmatter = parseFrontmatter(raw);
      const preserve = Array.isArray(frontmatter.preserve)
        ? frontmatter.preserve.map(({ repositoryKey, path: boundary }) => ({
            repositoryKey,
            path: boundary,
          }))
        : null;
      if (preserve === null)
        fail(
          'E_PLAN_REVIEW_PRESERVE_LEGACY',
          `Task ${frontmatter.id ?? path} requires structured Preserve custody.`,
        );
      return {
        id: frontmatter.id ?? basename(path, '.md'),
        storyId: frontmatter.storyId,
        path,
        dependsOn: Array.isArray(frontmatter.dependsOn) ? frontmatter.dependsOn : [],
        preserve,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function capturePlanningIdentity({ featureRoot, mode, slug } = {}) {
  if (
    typeof featureRoot !== 'string' ||
    !existsSync(featureRoot) ||
    !lstatSync(featureRoot).isDirectory()
  ) {
    fail('E_PLAN_REVIEW_SCOPE_INVALID', 'Planning review requires one real feature directory.');
  }
  const files = safeFiles(featureRoot);
  const spec = specFile(featureRoot, mode);
  const professionalSpecification = deriveProfessionalSpecification({ spec, mode, slug });
  const artifacts = files
    .map(({ path, absolute }) => ({
      path,
      contentDigest: digestBytes(normalizePlanningBytes(path, readFileSync(absolute))),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const tasks = taskGraph(featureRoot, files);
  if (!tasks.length)
    fail('E_PLAN_REVIEW_SCOPE_INVALID', 'Planning review requires at least one structured task.');
  const taskIds = new Set(tasks.map(({ id }) => id));
  if (
    taskIds.size !== tasks.length ||
    tasks.some(({ dependsOn }) => dependsOn.some((id) => !taskIds.has(id)))
  ) {
    fail(
      'E_PLAN_REVIEW_SCOPE_INVALID',
      'Planning review task identities and dependencies must form one closed graph.',
    );
  }
  const identity = {
    feature: { mode, featureId: professionalSpecification.source.featureId, slug },
    professionalSpecificationDigest: professionalSpecification.digest,
    artifacts,
    tasks,
  };
  return {
    ...identity,
    planDigest: sha256Jcs(identity),
    professionalSpecification,
  };
}
