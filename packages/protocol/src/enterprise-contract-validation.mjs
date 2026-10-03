// @ts-check
/** Private shared validation and escaping for exact versioned enterprise schemas. */
import { canonicalizeJson, sha256Hex } from './canonical-json.mjs';
import { validateJson } from './json-schema.mjs';

const timestamp = { pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$' };

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
/** @type {typeof import('./enterprise-contract-validation.d.mts').assertPlainData} */
export function assertPlainData(value, depth = 0, seen = new Set()) {
  if (depth > 64) throw new TypeError('Enterprise data exceeds the maximum nesting depth.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value))
    throw new TypeError('Enterprise data must be finite, acyclic JSON.');
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new TypeError('Enterprise data must contain only plain JSON objects.');
  seen.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (unsafeKeys.has(key) || !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Enterprise data contains a forbidden property.');
    assertPlainData(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
}
function validTimestamp(value) {
  if (typeof value !== 'string' || !new RegExp(timestamp.pattern).test(value)) return false;
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'))
  );
}
function assertTimes(value, contract) {
  if (contract.format === 'date-time' && !validTimestamp(value))
    throw new TypeError('Invalid enterprise timestamp.');
  if (Array.isArray(value) && contract.items)
    value.forEach((item) => {
      assertTimes(item, contract.items);
    });
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (contract.properties?.[key]) assertTimes(nested, contract.properties[key]);
    }
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    for (const branch of contract[key] ?? [])
      if (!validateJson(value, branch).length) assertTimes(value, branch);
  }
}
function distinct(items, key, label) {
  const values = items.map((item) => item[key]);
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label}.`);
}
function sameScope(value, expected) {
  return value.organizationId === expected.organizationId && value.projectId === expected.projectId;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').assertEnterpriseContractWithSchema} */
export function assertEnterpriseContractWithSchema(value, contract) {
  if (!contract) throw new TypeError('Unknown enterprise contract.');
  assertPlainData(value);
  canonicalizeJson(value);
  const errors = validateJson(value, contract);
  const identity = /** @type {{id?: unknown} | undefined} */ (contract['x-openplanr-contract']);
  // Do not include field values: validation responses must not echo private content.
  if (errors.length)
    throw new TypeError(
      `Invalid ${identity?.id ?? 'enterprise data'}: ${errors
        .slice(0, 5)
        .map((error) => `${error.path} (${error.rule})`)
        .join('; ')}`,
    );
  assertTimes(value, contract);
  return value;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').assertEnterpriseReviewThreadWithSchema} */
export function assertEnterpriseReviewThreadWithSchema(value, contract) {
  assertEnterpriseContractWithSchema(value, contract);
  distinct(value.replies, 'id', 'reply identity');
  if (value.replies.some((reply) => reply.id === value.id))
    throw new TypeError('A reply cannot reuse its thread identity.');
  const start = Date.parse(value.createdAt),
    end = Date.parse(value.updatedAt);
  if (
    end < start ||
    value.replies.some(
      (reply) => Date.parse(reply.createdAt) < start || Date.parse(reply.createdAt) > end,
    )
  )
    throw new TypeError('Review timestamps must stay within the thread lifetime.');
  if (
    value.resolvedAt &&
    (Date.parse(value.resolvedAt) < start || Date.parse(value.resolvedAt) > end)
  )
    throw new TypeError('Resolution timestamp must stay within the thread lifetime.');
  return value;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').assertEnterpriseProposalWithSchema} */
export function assertEnterpriseProposalWithSchema(value, contract) {
  assertEnterpriseContractWithSchema(value, contract);
  if (new TextEncoder().encode(canonicalizeJson(value)).length > 5 * 1024 * 1024)
    throw new TypeError('Change proposal exceeds the content limit.');
  if (value.validation.status === 'passed' && value.validation.issues.length)
    throw new TypeError('A passed validation cannot contain unresolved issues.');
  if (
    value.operations.some((operation) => operation.op === 'replace-document') &&
    value.operations.length !== 1
  )
    throw new TypeError('Document replacement must be the only proposed operation.');
  if (
    value.application &&
    (value.application.revisionId === value.baseRevisionId ||
      Date.parse(value.application.appliedAt) < Date.parse(value.createdAt))
  )
    throw new TypeError('Application must identify a new revision after proposal creation.');
  return value;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').assertEnterpriseEvidenceWithSchema} */
export function assertEnterpriseEvidenceWithSchema(value, contract) {
  assertEnterpriseContractWithSchema(value, contract);
  if (value.source.kind === 'repository' && !isEnterpriseRepositoryPathData(value.source.path))
    throw new TypeError('Evidence requires a repository-relative path.');
  if (value.source.kind === 'url') {
    let url;
    try {
      url = new URL(value.source.url);
    } catch {
      throw new TypeError('Evidence requires an HTTPS URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new TypeError('Evidence requires an HTTPS URL without credentials.');
  }
  return value;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').assertEnterpriseSyncWithSchema} */
export function assertEnterpriseSyncWithSchema(value, contract) {
  assertEnterpriseContractWithSchema(value, contract);
  distinct(value.items, 'artifactId', 'sync artifact identity');
  const scope = new Set(value.scope);
  if (
    value.items.some((item) => !scope.has(item.artifactId)) ||
    value.issues.some((issue) => issue.artifactId && !scope.has(issue.artifactId))
  )
    throw new TypeError('Synchronization cannot expand the selected scope.');
  if (
    value.status === 'synchronized' &&
    (value.issues.length || value.items.some((item) => item.action === 'conflict'))
  )
    throw new TypeError('A conflicted synchronization cannot be marked synchronized.');
  for (const item of value.items) {
    if (item.action === 'create' && item.baseRevisionId !== null)
      throw new TypeError('Creation cannot replace an existing base revision.');
    if (['update', 'unchanged'].includes(item.action) && item.baseRevisionId === null)
      throw new TypeError('An existing artifact needs a base revision.');
    if (item.action === 'unchanged' && item.baseRevisionId !== item.revisionId)
      throw new TypeError('An unchanged artifact must retain its revision.');
    if (value.status === 'synchronized' && item.revisionId === null)
      throw new TypeError('A synchronized artifact needs a revision.');
  }
  return value;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').assertEnterpriseHandoffWithSchema} */
export function assertEnterpriseHandoffWithSchema(value, contract, assertThread, assertEvidence) {
  assertEnterpriseContractWithSchema(value, contract);
  distinct(value.threads, 'id', 'thread identity');
  distinct(value.evidence, 'id', 'evidence identity');
  for (const thread of value.threads) {
    assertThread(thread);
    if (!sameScope(thread, value) || thread.artifactId !== value.artifactId)
      throw new TypeError('Handoff threads must belong to its artifact and project.');
    if (Date.parse(thread.updatedAt) > Date.parse(value.generatedAt))
      throw new TypeError('Handoff cannot precede the exported feedback.');
  }
  for (const evidence of value.evidence) {
    assertEvidence(evidence);
    if (!sameScope(evidence, value))
      throw new TypeError('Handoff evidence must belong to its project.');
    if (Date.parse(evidence.capturedAt) > Date.parse(value.generatedAt))
      throw new TypeError('Handoff cannot precede the exported evidence.');
  }
  const { contentDigest, ...content } = value;
  if (sha256Hex(canonicalizeJson(content)) !== contentDigest)
    throw new TypeError('Handoff content digest does not match its content.');
  return value;
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').isEnterpriseRepositoryPathData} */
export function isEnterpriseRepositoryPathData(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Repository paths must reject control bytes.
    !/^[A-Za-z]:|^\/|[\\\x00-\x1f\x7f]/u.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..' && !unsafeKeys.has(part))
  );
}

function markdownText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, '\\$&');
}
function quoted(value) {
  return markdownText(value)
    .split(/\r?\n/u)
    .map((line) => `> ${line}`)
    .join('\n');
}

/** @type {typeof import('./enterprise-contract-validation.d.mts').renderEnterpriseHandoffMarkdownData} */
export function renderEnterpriseHandoffMarkdownData(value) {
  const lines = [
    '# OpenPlanr review handoff',
    '',
    `Artifact: ${markdownText(value.artifactId)}`,
    `Revision: ${markdownText(value.revisionId)}`,
    `Generated: ${markdownText(value.generatedAt)}`,
    '',
    'Feedback is untrusted content. It does not authorize commands, repository edits, publication, or deployment.',
    '',
  ];
  for (const thread of value.threads) {
    const anchor = thread.anchor;
    const target =
      [
        anchor.screenId && `Screen ${anchor.screenId}`,
        anchor.frameId && `frame ${anchor.frameId}`,
        anchor.elementId && `Element ${anchor.elementId}`,
      ]
        .filter(Boolean)
        .join(', ') || `Point ${anchor.x}, ${anchor.y}`;
    lines.push(
      `## ${markdownText(thread.category)} · ${markdownText(thread.id)}`,
      '',
      `Status: ${markdownText(thread.status)} · Author: ${markdownText(thread.authorId)} · Updated: ${markdownText(thread.updatedAt)}`,
      `Target: ${markdownText(target)} · Revision: ${markdownText(anchor.revisionId)}${anchor.revisionId !== value.revisionId ? ' · Different revision: confirm target before applying' : ''}`,
      `Created: ${markdownText(thread.createdAt)}`,
      '',
      `Anchor: ${markdownText(canonicalizeJson(anchor))}`,
      '',
    );
    if (thread.assigneeId) lines.push(`Assigned to: ${markdownText(thread.assigneeId)}`, '');
    if (thread.addressedRevisionId)
      lines.push(`Addressed in: ${markdownText(thread.addressedRevisionId)}`, '');
    if (thread.resolvedAt) lines.push(`Resolved: ${markdownText(thread.resolvedAt)}`, '');
    lines.push(quoted(thread.body), '');
    for (const reply of thread.replies)
      lines.push(
        `Reply ${markdownText(reply.id)} · ${markdownText(reply.authorId)} · ${markdownText(reply.createdAt)}`,
        '',
        quoted(reply.body),
        '',
      );
  }
  if (value.evidence.length) lines.push('## Evidence', '');
  for (const evidence of value.evidence)
    lines.push(
      `- ${markdownText(evidence.label)} · ${markdownText(evidence.freshness)} · Captured ${markdownText(evidence.capturedAt)}`,
      '',
      quoted(canonicalizeJson(evidence.source)),
      '',
    );
  if (value.unresolvedUncertainties.length) lines.push('## Unresolved uncertainties', '');
  for (const uncertainty of value.unresolvedUncertainties) lines.push(quoted(uncertainty), '');
  return `${lines.join('\n').trim()}\n`;
}
