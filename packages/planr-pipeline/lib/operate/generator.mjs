import { createHash } from 'node:crypto';
import path from 'node:path';

import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';

const PROTOCOL_VERSION = '1.2.0';
const SCHEMA_VERSION = '1.0.0';
const MAX_ATTEMPTS = 3;
const FORMAT_EXTENSIONS = Object.freeze({
  markdown: '.md',
  html: '.html',
  json: '.json',
  csv: '.csv',
});
const DEFAULT_BUDGET = Object.freeze({
  maxBytes: 262_144,
  maxDurationMs: 120_000,
  maxTokens: 16_000,
  maxCostUsd: 2,
});
const DEFAULT_SANDBOX = Object.freeze({
  network: 'none',
  filesystem: 'none',
  tools: [],
  allowedUrlSchemes: ['https', 'mailto'],
});
const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_URL = /(?:javascript|data|vbscript|file):/iu;
const HTML_ACTIVE_CONTENT =
  /<(?:script|iframe|object|embed|form|base|meta)\b|(?:\s|^)on[a-z]+\s*=|srcdoc\s*=/iu;
const FORMULA_CELL = /^\s*[=+\-@]/u;
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9._-]{0,63})\}\}/gu;

function fail(code, message, details) {
  throw new PipelineError(code, message, '', details);
}

function digestText(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function assertIsoTimestamp(value, field) {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', `${field} must be an ISO-8601 UTC timestamp.`);
  }
}

function normalizeTemplate(template, artifactType) {
  if (
    !template ||
    typeof template !== 'object' ||
    typeof template.id !== 'string' ||
    !/^[a-z][a-z0-9._-]{0,63}$/u.test(template.id) ||
    typeof template.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(template.version) ||
    typeof template.body !== 'string' ||
    template.body.length === 0 ||
    template.artifactType !== artifactType
  ) {
    fail(
      'E_OPERATE_ARTIFACT_TEMPLATE_INVALID',
      'Generation requires a typed, versioned template matching the artifact format.',
    );
  }
  const requiredVariables = [...new Set(template.requiredVariables ?? [])].sort();
  if (
    requiredVariables.some(
      (entry) => typeof entry !== 'string' || !/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/u.test(entry),
    )
  ) {
    fail(
      'E_OPERATE_ARTIFACT_TEMPLATE_INVALID',
      'Template variables must use bounded identifier names.',
    );
  }
  return {
    id: template.id,
    version: template.version,
    artifactType,
    body: template.body,
    requiredVariables,
    digest: sha256Jcs({
      id: template.id,
      version: template.version,
      artifactType,
      body: template.body,
      requiredVariables,
    }),
  };
}

function normalizeBudget(budget = {}) {
  const normalized = { ...DEFAULT_BUDGET, ...budget };
  const integerFields = [
    ['maxBytes', 1, 1_048_576],
    ['maxDurationMs', 100, 600_000],
  ];
  for (const [field, minimum, maximum] of integerFields) {
    if (
      !Number.isInteger(normalized[field]) ||
      normalized[field] < minimum ||
      normalized[field] > maximum
    ) {
      fail(
        'E_OPERATE_ARTIFACT_BUDGET_INVALID',
        `${field} must be an integer between ${minimum} and ${maximum}.`,
      );
    }
  }
  if (
    normalized.maxTokens !== null &&
    (!Number.isInteger(normalized.maxTokens) ||
      normalized.maxTokens < 1 ||
      normalized.maxTokens > 1_000_000)
  ) {
    fail('E_OPERATE_ARTIFACT_BUDGET_INVALID', 'maxTokens must be null or a bounded integer.');
  }
  if (
    normalized.maxCostUsd !== null &&
    (typeof normalized.maxCostUsd !== 'number' ||
      !Number.isFinite(normalized.maxCostUsd) ||
      normalized.maxCostUsd < 0 ||
      normalized.maxCostUsd > 1_000)
  ) {
    fail('E_OPERATE_ARTIFACT_BUDGET_INVALID', 'maxCostUsd must be null or a bounded number.');
  }
  return normalized;
}

function normalizeSandbox(sandbox = {}) {
  const normalized = {
    ...DEFAULT_SANDBOX,
    ...sandbox,
    tools: [...(sandbox.tools ?? DEFAULT_SANDBOX.tools)],
    allowedUrlSchemes: [
      ...new Set(sandbox.allowedUrlSchemes ?? DEFAULT_SANDBOX.allowedUrlSchemes),
    ].sort(),
  };
  if (
    normalized.network !== 'none' ||
    !['none', 'project-read-only'].includes(normalized.filesystem) ||
    normalized.tools.length > 0 ||
    normalized.allowedUrlSchemes.some((scheme) => !['https', 'mailto'].includes(scheme))
  ) {
    fail(
      'E_OPERATE_ARTIFACT_SANDBOX_INVALID',
      'Operating artifact generation requires no network, no tools, and an isolated filesystem.',
    );
  }
  return normalized;
}

function assertDestination(destination, cycleId, artifactType) {
  if (
    typeof destination !== 'string' ||
    destination.includes('\\') ||
    destination.includes('\0') ||
    path.posix.isAbsolute(destination) ||
    path.posix.normalize(destination) !== destination ||
    destination.split('/').includes('..') ||
    path.posix.extname(destination).toLowerCase() !== FORMAT_EXTENSIONS[artifactType]
  ) {
    fail(
      'E_OPERATE_ARTIFACT_DESTINATION_INVALID',
      'Artifact destination must be a normalized project-relative path matching its format.',
    );
  }
  const prefix = `.planr/operate/cycles/${cycleId}/artifacts/`;
  if (!destination.startsWith(prefix) || destination.length <= prefix.length) {
    fail(
      'E_OPERATE_ARTIFACT_DESTINATION_INVALID',
      `Artifact destination must remain inside ${prefix}.`,
    );
  }
}

function assertPlainText(value) {
  if (value.includes('\0') || BIDI_CONTROL.test(value)) {
    fail(
      'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
      'Generated output contains null bytes or bidirectional control characters.',
    );
  }
}

function assertJsonValue(value, depth = 0, keys = { count: 0 }) {
  if (depth > 32) {
    fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated JSON exceeds the depth limit.');
  }
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated JSON contains a non-finite number.');
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) {
      fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated JSON exceeds the array item limit.');
    }
    for (const entry of value) assertJsonValue(entry, depth + 1, keys);
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated JSON must contain plain JSON values.');
  }
  for (const [key, entry] of Object.entries(value)) {
    keys.count += 1;
    if (
      keys.count > 10_000 ||
      key.length > 256 ||
      ['__proto__', 'prototype', 'constructor'].includes(key)
    ) {
      fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated JSON contains an unsafe key shape.');
    }
    assertJsonValue(entry, depth + 1, keys);
  }
}

function normalizeJson(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated JSON is not valid JSON.');
  }
  assertJsonValue(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function assertCsv(content) {
  const rows = content.replace(/\r\n?/gu, '\n').split('\n');
  if (rows.length > 10_001) {
    fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated CSV exceeds the row limit.');
  }
  for (const row of rows) {
    if (row.length > 65_536) {
      fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated CSV exceeds the row-width limit.');
    }
    for (const cell of row.split(',')) {
      const unquoted = cell.replace(/^"|"$/gu, '').replace(/""/gu, '"');
      if (FORMULA_CELL.test(unquoted)) {
        fail(
          'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
          'Generated CSV contains a spreadsheet formula cell.',
        );
      }
    }
  }
}

function normalizeOutput(session, content) {
  if (typeof content !== 'string') {
    fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated artifact output must be UTF-8 text.');
  }
  assertPlainText(content);
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > session.generation.budget.maxBytes) {
    fail(
      'E_OPERATE_ARTIFACT_BUDGET_EXCEEDED',
      `Generated output is ${byteLength} bytes; budget allows ${session.generation.budget.maxBytes}.`,
    );
  }
  if (session.artifactType === 'json') return normalizeJson(content);
  if (session.artifactType === 'csv') assertCsv(content);
  if (UNSAFE_URL.test(content)) {
    fail('E_OPERATE_ARTIFACT_OUTPUT_INVALID', 'Generated output contains an unsafe URL scheme.');
  }
  if (session.artifactType === 'html' && HTML_ACTIVE_CONTENT.test(content)) {
    fail(
      'E_OPERATE_ARTIFACT_OUTPUT_INVALID',
      'Generated HTML contains active content outside the operating artifact sandbox.',
    );
  }
  return content.replace(/\r\n?/gu, '\n');
}

function assertTransition(session, allowed, action) {
  assertProtocolArtifact('operating-artifact-session', session);
  if (!allowed.includes(session.state)) {
    fail(
      'E_OPERATE_ARTIFACT_STATE_INVALID',
      `Cannot ${action} an artifact session from ${session.state}.`,
    );
  }
}

function withState(session, state, now, additional = {}) {
  assertIsoTimestamp(now, 'updatedAt');
  return assertProtocolArtifact('operating-artifact-session', {
    ...structuredClone(session),
    ...additional,
    state,
    updatedAt: now,
  });
}

export function renderOperatingArtifactTemplate(template, variables) {
  const normalized = normalizeTemplate(template, template.artifactType);
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    fail('E_OPERATE_ARTIFACT_TEMPLATE_INVALID', 'Template variables must be a JSON object.');
  }
  for (const name of normalized.requiredVariables) {
    if (!Object.hasOwn(variables, name)) {
      fail('E_OPERATE_ARTIFACT_TEMPLATE_INVALID', `Template variable ${name} is required.`);
    }
  }
  const rendered = normalized.body.replace(PLACEHOLDER, (_match, name) => {
    if (!Object.hasOwn(variables, name)) {
      fail('E_OPERATE_ARTIFACT_TEMPLATE_INVALID', `Template variable ${name} is missing.`);
    }
    const raw = String(variables[name]);
    assertPlainText(raw);
    if (normalized.artifactType !== 'html') return raw;
    return raw
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  });
  return { content: rendered, template: normalized };
}

export function prepareOperatingArtifactGeneration(input) {
  const now = input.now ?? new Date().toISOString();
  assertIsoTimestamp(now, 'createdAt');
  if (!Object.hasOwn(FORMAT_EXTENSIONS, input.artifactType)) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', 'Unsupported operating artifact format.');
  }
  if (!/^ART-[A-Za-z0-9._-]+$/u.test(input.id ?? '')) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', 'Artifact session id must start with ART-.');
  }
  if (!/^CYCLE-\d{3,}$/u.test(input.cycleId ?? '')) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', 'Artifact generation requires a cycle id.');
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.inputDigest ?? '')) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', 'Artifact generation requires an input digest.');
  }
  if (
    !Array.isArray(input.evidenceRefs) ||
    input.evidenceRefs.length === 0 ||
    input.evidenceRefs.some((reference) => !/^EVD-[A-Za-z0-9._-]+$/u.test(reference))
  ) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', 'Artifact generation requires evidence references.');
  }
  assertDestination(input.destination, input.cycleId, input.artifactType);
  const template = normalizeTemplate(input.template, input.artifactType);
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    fail('E_OPERATE_ARTIFACT_BUDGET_INVALID', 'Generation supports one to three attempts.');
  }
  return assertProtocolArtifact('operating-artifact-session', {
    kind: 'operating-artifact-session',
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    id: input.id,
    cycleId: input.cycleId,
    state: 'prepared',
    artifactType: input.artifactType,
    inputDigest: input.inputDigest,
    destination: input.destination,
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(),
    producer: structuredClone(input.producer),
    generation: {
      template: {
        id: template.id,
        version: template.version,
        digest: template.digest,
      },
      attempt: 0,
      maxAttempts,
      budget: normalizeBudget(input.budget),
      sandbox: normalizeSandbox(input.sandbox),
    },
    createdAt: now,
    updatedAt: now,
  });
}

export function startOperatingArtifactGeneration(session, options = {}) {
  assertTransition(session, ['prepared'], 'start');
  return withState(session, 'generating', options.now ?? new Date().toISOString(), {
    generation: {
      ...structuredClone(session.generation),
      attempt: session.generation.attempt + 1,
    },
  });
}

export function validateOperatingArtifactOutput(session, content, options = {}) {
  assertTransition(session, ['generating'], 'validate');
  const normalizedContent = normalizeOutput(session, content);
  const now = options.now ?? new Date().toISOString();
  const outputDigest = digestText(normalizedContent);
  const validatedSession = withState(session, 'validated', now, {
    outputDigest,
    provenance: {
      templateDigest: session.generation.template.digest,
      inputDigest: session.inputDigest,
      outputDigest,
      generatedAt: now,
    },
  });
  return { session: validatedSession, content: normalizedContent };
}

export function commitOperatingArtifactGeneration(session, options = {}) {
  assertTransition(session, ['validated'], 'commit');
  return withState(session, 'committed', options.now ?? new Date().toISOString());
}

export function failOperatingArtifactGeneration(session, failureCode, options = {}) {
  assertTransition(session, ['generating'], 'fail');
  if (!/^E_[A-Z0-9_]+$/u.test(failureCode ?? '')) {
    fail('E_OPERATE_ARTIFACT_SESSION_INVALID', 'Generation failure requires a named error code.');
  }
  return withState(session, 'failed', options.now ?? new Date().toISOString(), {
    failureCode,
  });
}

export function resumeOperatingArtifactGeneration(session, options = {}) {
  assertTransition(session, ['failed'], 'resume');
  if (session.generation.attempt >= session.generation.maxAttempts) {
    fail(
      'E_OPERATE_ARTIFACT_RETRY_EXHAUSTED',
      `Artifact generation exhausted ${session.generation.maxAttempts} attempts.`,
    );
  }
  const resumed = structuredClone(session);
  delete resumed.failureCode;
  return withState(resumed, 'prepared', options.now ?? new Date().toISOString());
}

export function cancelOperatingArtifactGeneration(session, options = {}) {
  assertTransition(session, ['prepared', 'generating', 'failed'], 'cancel');
  return withState(session, 'cancelled', options.now ?? new Date().toISOString());
}

export async function runOperatingArtifactGeneration(input) {
  let session =
    input.session.state === 'failed'
      ? resumeOperatingArtifactGeneration(input.session, { now: input.now?.() })
      : input.session;
  const attempts = [];
  while (session.generation.attempt < session.generation.maxAttempts) {
    session = startOperatingArtifactGeneration(session, { now: input.now?.() });
    const startedAt = Date.now();
    let timedOut = false;
    try {
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new PipelineError(
              'E_OPERATE_ARTIFACT_BUDGET_EXCEEDED',
              `Generation exceeded ${session.generation.budget.maxDurationMs}ms.`,
            ),
          );
          controller.abort();
        }, session.generation.budget.maxDurationMs);
      });
      let result;
      try {
        result = await Promise.race([
          input.generate({
            attempt: session.generation.attempt,
            inputDigest: session.inputDigest,
            evidenceRefs: [...session.evidenceRefs],
            artifactType: session.artifactType,
            budget: structuredClone(session.generation.budget),
            sandbox: structuredClone(session.generation.sandbox),
            signal: controller.signal,
          }),
          timeout,
        ]);
      } finally {
        clearTimeout(timer);
      }
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > session.generation.budget.maxDurationMs) {
        fail(
          'E_OPERATE_ARTIFACT_BUDGET_EXCEEDED',
          `Generation exceeded ${session.generation.budget.maxDurationMs}ms.`,
        );
      }
      if (
        session.generation.budget.maxTokens !== null &&
        result.usage?.tokens > session.generation.budget.maxTokens
      ) {
        fail('E_OPERATE_ARTIFACT_BUDGET_EXCEEDED', 'Generation exceeded its token budget.');
      }
      if (
        session.generation.budget.maxCostUsd !== null &&
        result.usage?.costUsd > session.generation.budget.maxCostUsd
      ) {
        fail('E_OPERATE_ARTIFACT_BUDGET_EXCEEDED', 'Generation exceeded its cost budget.');
      }
      const validated = validateOperatingArtifactOutput(session, result.content, {
        now: input.now?.(),
      });
      return {
        session: commitOperatingArtifactGeneration(validated.session, { now: input.now?.() }),
        content: validated.content,
        attempts: [...attempts, { attempt: session.generation.attempt, status: 'committed' }],
      };
    } catch (error) {
      const failureCode =
        timedOut
          ? 'E_OPERATE_ARTIFACT_BUDGET_EXCEEDED'
          : error instanceof PipelineError
            ? error.code
            : 'E_OPERATE_ARTIFACT_GENERATION_FAILED';
      session = failOperatingArtifactGeneration(session, failureCode, { now: input.now?.() });
      attempts.push({ attempt: session.generation.attempt, status: 'failed', failureCode });
      if (session.generation.attempt >= session.generation.maxAttempts) {
        throw new PipelineError(
          'E_OPERATE_ARTIFACT_RETRY_EXHAUSTED',
          `Artifact generation failed after ${session.generation.maxAttempts} attempts.`,
          '',
          { attempts },
        );
      }
      session = resumeOperatingArtifactGeneration(session, { now: input.now?.() });
    }
  }
  fail('E_OPERATE_ARTIFACT_RETRY_EXHAUSTED', 'Artifact generation attempts are exhausted.');
}
