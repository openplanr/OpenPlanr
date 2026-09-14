import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

import { parse as parseHtml } from 'parse5';

import { PipelineError } from '../pipeline/errors.mjs';
import { evaluationContentDigest } from '../pipeline/evaluation-identity.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { estimateTokens, frictionCount } from './metrics.mjs';

export const EVALUATION_JOURNEY_KINDS = Object.freeze(['positive', 'negative', 'ambiguity', 'permission-denied', 'recovery', 'packed-install']);

/** Prompt class every journey kind is authored under. Recovery and packed install exercise the invoking path. */
export const EVALUATION_JOURNEY_PROMPT_CLASS = Object.freeze({
  positive: 'positive',
  negative: 'negative',
  ambiguity: 'ambiguous',
  'permission-denied': 'permission-denied',
  recovery: 'positive',
  'packed-install': 'positive',
});

export const EVALUATION_BROWSER_EVIDENCE_CLASSES = Object.freeze(['route', 'form', 'viewport', 'accessibility', 'console', 'network']);

/** Words that carry no routing signal. Kept small so a phrase never collapses to nothing. */
const STOPWORDS = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'and', 'or', 'of', 'to', 'in', 'into', 'on', 'at', 'for', 'from', 'with', 'by', 'is', 'are', 'be', 'it', 'its', 'as', 'my', 'our', 'your', 'me', 'we', 'i', 'you', 'please', 'before', 'after', 'then']);

/** Surface words that name a capability a host can grant or deny. */
const CAPABILITY_WORDS = Object.freeze({
  'file-read': ['read', 'inspect', 'open'],
  'file-write': ['write', 'edit', 'author', 'rewrite'],
  'command-execute': ['execute', 'shell', 'subprocess'],
  network: ['network', 'internet', 'remote', 'download', 'upload', 'fetch'],
  browser: ['browser', 'chromium', 'screenshot'],
  credential: ['credential', 'secret', 'token', 'password'],
  git: ['git', 'commit', 'push', 'branch', 'tag'],
  publish: ['publish', 'npm', 'marketplace'],
  deploy: ['deploy', 'deployment', 'production'],
});

/** Routing floors, in basis points of phrase coverage. */
const CONFIDENT_FLOOR = 7_000;
const AMBIGUITY_FLOOR = 3_000;
const CONFIDENT_MARGIN = 2_000;

const LOOPBACK_HOST = '127.0.0.1';
const CLI_TIMEOUT_MS = 30_000;

/** Variables a child process needs to start at all. Everything else, credentials included, is withheld. */
const CLI_ENVIRONMENT_PASSTHROUGH = Object.freeze(['PATH', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP']);

/** A journey never inherits the operator's credentials or the caller's project state. */
function journeyEnvironment(cwd) {
  const environment = { HOME: cwd, USERPROFILE: cwd, NODE_ENV: 'test' };
  for (const name of CLI_ENVIRONMENT_PASSTHROUGH) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

export function evaluationPromptTokens(text) {
  if (typeof text !== 'string') fail('E_EVALUATION_JOURNEY_INVALID', 'Routing needs decoded prompt text.', 'Read the prompt fixture bytes as UTF-8.');
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/u).filter((token) => token.length > 0 && !STOPWORDS.has(token));
  return Object.freeze([...new Set(tokens)]);
}

/** Basis points of a declared phrase covered by the prompt. */
function coverage(phrase, promptTokens) {
  const phraseTokens = evaluationPromptTokens(phrase);
  if (phraseTokens.length === 0) return 0;
  const hits = phraseTokens.filter((token) => promptTokens.includes(token)).length;
  return Math.floor((hits * 10_000) / phraseTokens.length);
}

function bestCoverage(phrases, promptTokens) {
  return phrases.reduce((best, phrase) => Math.max(best, coverage(phrase, promptTokens)), 0);
}

/**
 * Deterministic trigger routing from the catalog's own declared trigger policy.
 * A capability the host explicitly denied outranks every routing signal, so a
 * denied prompt refuses instead of invoking.
 */
export function routeTrigger({ promptText, triggerPolicy, declaredPermissions = [] }) {
  const promptTokens = evaluationPromptTokens(promptText);
  if (!triggerPolicy || !Array.isArray(triggerPolicy.include) || !Array.isArray(triggerPolicy.exclude)) {
    fail('E_EVALUATION_JOURNEY_INVALID', 'Trigger routing needs the catalog trigger policy.', 'Pass the include and exclude phrases the skill declares.');
  }
  const denied = new Set(declaredPermissions.filter((entry) => entry.decision === 'denied').map((entry) => entry.capability));
  const requested = Object.entries(CAPABILITY_WORDS)
    .filter(([, words]) => words.some((word) => promptTokens.includes(word)))
    .map(([capability]) => capability);
  const refusedCapabilities = requested.filter((capability) => denied.has(capability)).sort();

  const includeScore = bestCoverage(triggerPolicy.include, promptTokens);
  const excludeScore = bestCoverage(triggerPolicy.exclude, promptTokens);

  let outcome;
  let reason;
  if (refusedCapabilities.length > 0) {
    outcome = 'refuse';
    reason = 'CAPABILITY_DENIED_BY_HOST';
  } else if (excludeScore >= AMBIGUITY_FLOOR && excludeScore >= includeScore) {
    outcome = 'decline';
    reason = 'EXCLUDED_BY_TRIGGER_POLICY';
  } else if (includeScore >= CONFIDENT_FLOOR && includeScore - excludeScore >= CONFIDENT_MARGIN) {
    outcome = 'invoke';
    reason = 'MATCHED_TRIGGER_POLICY';
  } else if (includeScore >= AMBIGUITY_FLOOR) {
    outcome = 'clarify';
    reason = 'AMBIGUOUS_TRIGGER_SIGNAL';
  } else {
    outcome = 'decline';
    reason = 'NO_TRIGGER_SIGNAL';
  }
  return Object.freeze({ outcome, reason, includeScore, excludeScore, refusedCapabilities: Object.freeze(refusedCapabilities) });
}

/** One permission prompt per effectful grant, on a host whose permission model prompts. */
export function countPermissionPrompts(hostProfile, declaredPermissions) {
  if (hostProfile.permissionModel.mode !== 'prompted') return 0;
  const effectful = new Set(['file-write', 'command-execute', 'network', 'browser', 'credential', 'git', 'publish', 'deploy']);
  return declaredPermissions.filter((entry) => entry.decision === 'granted' && effectful.has(entry.capability)).length;
}

function journeyResult(fields) {
  const result = {
    completed: false,
    terminalReason: 'NOT_RUN',
    absence: null,
    retries: 0,
    clarifications: 0,
    typedUnavailable: 0,
    outputs: [],
    evidence: [],
    ...fields,
  };
  result.frictions = frictionCount({
    permissionPrompts: result.permissionPrompts ?? 0,
    retries: result.retries,
    clarifications: result.clarifications,
    typedUnavailable: result.typedUnavailable,
  });
  return Object.freeze(result);
}

function absence(code, reason, recoveryDisposition) {
  return Object.freeze({ code, reason, treatedAsPass: false, recoveryDisposition });
}

// ── Host journey ────────────────────────────────────────────────────────────

/** The trigger decision itself, graded against the scenario's expected outcome. */
export function runHostJourney({ scenario, promptText, triggerPolicy, hostProfile }) {
  if (!hostProfile.skillHostSupport) {
    return journeyResult({
      driver: 'host',
      observedTrigger: null,
      permissionPrompts: 0,
      absence: absence('host-unavailable', 'The host profile declares no skill host support, so no trigger decision exists to grade.', 'escalate'),
      terminalReason: 'HOST_WITHOUT_SKILL_SUPPORT',
    });
  }
  const routed = routeTrigger({ promptText, triggerPolicy, declaredPermissions: scenario.declaredPermissions });
  return journeyResult({
    driver: 'host',
    observedTrigger: routed.outcome,
    permissionPrompts: countPermissionPrompts(hostProfile, scenario.declaredPermissions),
    clarifications: routed.outcome === 'clarify' ? 1 : 0,
    completed: true,
    terminalReason: routed.reason,
    outputs: [Object.freeze({
      contractId: 'evaluation-trigger-decision',
      record: Object.freeze({ outcome: routed.outcome, includeScore: routed.includeScore, excludeScore: routed.excludeScore }),
    })],
  });
}

// ── CLI journey ─────────────────────────────────────────────────────────────

const CLI_ENVELOPE_KEYS = Object.freeze(['ok', 'code', 'problem', 'fix']);

/** The closed envelope every typed CLI answer has to satisfy in both output modes. */
export function assertCliEnvelope(value, label = 'cli envelope') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_EVALUATION_CLI_ENVELOPE_INVALID', `${label} must be one JSON object.`, 'A typed CLI answer is an object, never a bare string.');
  }
  const unknown = Object.keys(value).filter((key) => !CLI_ENVELOPE_KEYS.includes(key));
  if (unknown.length > 0) fail('E_EVALUATION_CLI_ENVELOPE_INVALID', `${label} carries unknown fields.`, `Declare only: ${CLI_ENVELOPE_KEYS.join(', ')}.`, { unknown });
  if (typeof value.ok !== 'boolean') fail('E_EVALUATION_CLI_ENVELOPE_INVALID', `${label}.ok must be an explicit boolean.`, 'A typed answer states its outcome.');
  if (value.ok === false && !/^E_[A-Z0-9_]{3,63}$/u.test(String(value.code))) {
    fail('E_EVALUATION_CLI_ENVELOPE_INVALID', `${label}.code is not a typed refusal code.`, 'A refusal is typed; an exit status alone is not a result.', { code: value.code ?? null });
  }
  return value;
}

/**
 * The real command grammar in both output modes.
 * Identical argv is invoked once and shared, so a run stays deterministic and
 * the observation binds the command it actually graded.
 */
export function createCliDriver({ executable, cwd, cache = new Map() } = {}) {
  if (typeof executable !== 'string' || !isAbsolute(executable)) {
    fail('E_EVALUATION_JOURNEY_INVALID', 'The CLI driver needs the absolute path of the command entrypoint.', 'Resolve bin/planr-pipeline.mjs from the repository root.');
  }
  const invoke = (argv, mode) => {
    const key = sha256Jcs({ argv, mode });
    if (cache.has(key)) return cache.get(key);
    const started = Date.now();
    const spawned = spawnSync(process.execPath, [executable, ...argv, ...(mode === 'json' ? ['--json'] : [])], {
      cwd,
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
      input: '',
      env: journeyEnvironment(cwd),
    });
    const text = `${spawned.stdout ?? ''}${spawned.stderr ?? ''}`.trim();
    let envelope = null;
    try {
      envelope = assertCliEnvelope(JSON.parse(text));
    } catch {
      envelope = null;
    }
    const record = Object.freeze({
      argvDigest: sha256Jcs(argv),
      mode,
      envelope,
      status: spawned.status ?? null,
      latencyMs: Math.max(0, Date.now() - started),
      outputDigest: evaluationContentDigest(text),
      outputTokens: estimateTokens(text),
    });
    cache.set(key, record);
    return record;
  };
  return Object.freeze({ invoke });
}

/**
 * Drives one declared command in human and strict JSON output.
 * Recovery is asserted on the typed code, never on the exit status.
 */
export function runCliJourney({ driver, argv, expectTypedUnavailable = true }) {
  const human = driver.invoke(argv, 'human');
  const strict = driver.invoke(argv, 'json');
  if (strict.envelope === null || human.envelope === null) {
    return journeyResult({
      driver: 'cli',
      permissionPrompts: 0,
      latencyMs: human.latencyMs + strict.latencyMs,
      outputTokens: human.outputTokens + strict.outputTokens,
      absence: absence('fixture-unavailable', 'The command surface answered with untyped output, so no typed result could be graded.', 'escalate'),
      terminalReason: 'CLI_OUTPUT_UNTYPED',
    });
  }
  const typedUnavailable = strict.envelope.ok === false ? 1 : 0;
  if (expectTypedUnavailable && typedUnavailable === 0) {
    return journeyResult({
      driver: 'cli',
      permissionPrompts: 0,
      latencyMs: human.latencyMs + strict.latencyMs,
      outputTokens: human.outputTokens + strict.outputTokens,
      completed: false,
      terminalReason: 'CLI_UNEXPECTED_SUCCESS',
    });
  }
  if (human.envelope.ok !== strict.envelope.ok || human.envelope.code !== strict.envelope.code) {
    return journeyResult({
      driver: 'cli',
      permissionPrompts: 0,
      latencyMs: human.latencyMs + strict.latencyMs,
      outputTokens: human.outputTokens + strict.outputTokens,
      completed: false,
      terminalReason: 'CLI_OUTPUT_MODES_DISAGREE',
    });
  }
  return journeyResult({
    driver: 'cli',
    permissionPrompts: 0,
    latencyMs: human.latencyMs + strict.latencyMs,
    outputTokens: human.outputTokens + strict.outputTokens,
    typedUnavailable,
    completed: true,
    terminalReason: typedUnavailable === 1 ? 'CLI_TYPED_UNAVAILABLE' : 'CLI_TYPED_RESULT',
    outputs: [Object.freeze({ contractId: 'evaluation-cli-envelope', record: strict.envelope })],
    evidence: [Object.freeze({ class: 'trace', contentDigest: strict.outputDigest })],
  });
}

// ── Browser journey ─────────────────────────────────────────────────────────

const LOOPBACK_SURFACE_KEYS = Object.freeze(['kind', 'schemaVersion', 'routes', 'viewports', 'forms']);

export function assertLoopbackSurface(value, label = 'loopback surface') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('E_EVALUATION_LOOPBACK_INVALID', `${label} must be one JSON object.`, 'Pass the parsed loopback surface fixture.');
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...LOOPBACK_SURFACE_KEYS].sort())) {
    fail('E_EVALUATION_LOOPBACK_INVALID', `${label} has missing or unknown fields.`, `Declare exactly: ${LOOPBACK_SURFACE_KEYS.join(', ')}.`);
  }
  if (value.kind !== 'evaluation-loopback-surface' || value.schemaVersion !== '1.0.0') {
    fail('E_EVALUATION_LOOPBACK_INVALID', `${label} carries an implicit or foreign surface version.`, 'Declare kind "evaluation-loopback-surface" and schemaVersion "1.0.0".');
  }
  if (!Array.isArray(value.routes) || value.routes.length === 0) fail('E_EVALUATION_LOOPBACK_INVALID', `${label}.routes must declare at least one route.`, 'A surface with no route exercises nothing.');
  for (const [index, route] of value.routes.entries()) {
    const cursor = `${label}.routes[${index}]`;
    const keys = Object.keys(route).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['contentType', 'document', 'path', 'status'])) {
      fail('E_EVALUATION_LOOPBACK_INVALID', `${cursor} has missing or unknown fields.`, 'Declare exactly: contentType, document, path, status.');
    }
    if (!route.path.startsWith('/') || route.path.includes('..')) fail('E_EVALUATION_LOOPBACK_INVALID', `${cursor}.path must be one rooted loopback path.`, 'Declare a rooted path with no traversal.');
  }
  return value;
}

/**
 * A disposable loopback surface served from memory.
 * Nothing is written to disk and nothing leaves the loopback interface, so a
 * browser journey never touches the hosted site.
 */
export async function startLoopbackSurface(surface) {
  assertLoopbackSurface(surface);
  const requests = [];
  const routes = new Map(surface.routes.map((route) => [route.path, route]));
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    requests.push({ method: request.method ?? 'GET', path });
    const route = routes.get(path);
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(route.status, { 'content-type': route.contentType });
    response.end(route.document);
  });
  await new Promise((settle) => server.listen(0, LOOPBACK_HOST, settle));
  const { port } = server.address();
  return Object.freeze({
    origin: `http://${LOOPBACK_HOST}:${port}`,
    requests,
    close: () => new Promise((settle) => server.close(settle)),
  });
}

function walkHtml(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walkHtml(child, visit);
}

function attribute(node, name) {
  return node.attrs?.find((attr) => attr.name === name)?.value ?? null;
}

/**
 * The default trusted browser runtime adapter: a loopback document reader.
 * It attests only what the served bytes prove. A document that carries script
 * has an unobservable console channel, so console evidence goes unattested and
 * the journey stays blocking rather than inferring a pass.
 */
export function createLoopbackBrowserAdapter() {
  return Object.freeze({
    adapterId: 'loopback-document-reader',
    trusted: true,
    attests: Object.freeze([...EVALUATION_BROWSER_EVIDENCE_CLASSES]),
    async probe(session, surface) {
      const evidence = [];
      const unattested = [];
      for (const route of surface.routes) {
        const response = await fetch(`${session.origin}${route.path}`, { redirect: 'error' });
        const body = await response.text();
        if (response.status !== route.status) {
          unattested.push('route');
          continue;
        }
        const document = parseHtml(body);
        const forms = [];
        const labelled = { inputs: 0, labelled: 0 };
        let scripts = 0;
        let viewportMeta = null;
        let language = null;
        let headings = 0;
        walkHtml(document, (node) => {
          if (node.nodeName === 'script') scripts += 1;
          if (node.nodeName === 'html') language = attribute(node, 'lang');
          if (node.nodeName === 'meta' && attribute(node, 'name') === 'viewport') viewportMeta = attribute(node, 'content');
          if (/^h[1-6]$/u.test(node.nodeName)) headings += 1;
          if (node.nodeName === 'form') forms.push({ action: attribute(node, 'action'), method: (attribute(node, 'method') ?? 'get').toLowerCase() });
          if (node.nodeName === 'input') {
            labelled.inputs += 1;
            if (attribute(node, 'aria-label') !== null || attribute(node, 'id') !== null) labelled.labelled += 1;
          }
          if (node.attrs?.some((attr) => attr.name.startsWith('on'))) scripts += 1;
        });
        evidence.push({
          path: route.path,
          status: response.status,
          forms,
          inputs: labelled.inputs,
          labelledInputs: labelled.labelled,
          headings,
          language,
          viewportMeta,
          scripts,
          bodyDigest: evaluationContentDigest(body),
        });
        if (scripts > 0) unattested.push('console');
        if (viewportMeta === null) unattested.push('viewport');
        if (language === null || labelled.labelled !== labelled.inputs) unattested.push('accessibility');
      }
      return Object.freeze({ evidence, unattested: Object.freeze([...new Set(unattested)].sort()) });
    },
  });
}

/**
 * A browser journey over a disposable loopback surface.
 * Without a trusted adapter, or with any declared evidence class unattested, the
 * journey records a typed absence; it never fabricates a host, session, or digest.
 */
export async function runBrowserJourney({ surface, adapter, declaredViewports }) {
  if (!adapter || adapter.trusted !== true) {
    return journeyResult({
      driver: 'browser',
      permissionPrompts: 0,
      latencyMs: 0,
      absence: absence('host-unavailable', 'No registered trusted browser runtime adapter was available for this run.', 'escalate'),
      terminalReason: 'BROWSER_TRUSTED_HOST_REQUIRED',
    });
  }
  const missing = EVALUATION_BROWSER_EVIDENCE_CLASSES.filter((entry) => !adapter.attests.includes(entry));
  if (missing.length > 0) {
    return journeyResult({
      driver: 'browser',
      permissionPrompts: 0,
      latencyMs: 0,
      absence: absence('host-unavailable', 'The registered adapter cannot attest every declared browser evidence class.', 'escalate'),
      terminalReason: 'BROWSER_EVIDENCE_UNATTESTED',
    });
  }
  const started = Date.now();
  const session = await startLoopbackSurface(surface);
  try {
    const probed = await adapter.probe(session, surface);
    const latencyMs = Math.max(0, Date.now() - started);
    if (probed.unattested.length > 0) {
      return journeyResult({
        driver: 'browser',
        permissionPrompts: 0,
        latencyMs,
        absence: absence('host-unavailable', 'The loopback surface left a declared evidence class unattested.', 'rerun'),
        terminalReason: 'BROWSER_EVIDENCE_UNATTESTED',
      });
    }
    const declaredForms = surface.forms.map((form) => `${form.method}:${form.action}`).sort();
    const observedForms = probed.evidence.flatMap((entry) => entry.forms.map((form) => `${form.method}:${form.action}`)).sort();
    const formsMatch = JSON.stringify(declaredForms) === JSON.stringify(observedForms);
    const record = {
      routes: probed.evidence.map((entry) => ({ path: entry.path, status: entry.status })),
      forms: observedForms.length,
      viewports: declaredViewports.length,
      accessibleDocuments: probed.evidence.filter((entry) => entry.language !== null && entry.labelledInputs === entry.inputs).length,
      consoleChannel: 'no-console-channel',
      networkRequests: session.requests.length,
    };
    return journeyResult({
      driver: 'browser',
      permissionPrompts: 0,
      latencyMs,
      completed: formsMatch,
      terminalReason: formsMatch ? 'BROWSER_EVIDENCE_RECORDED' : 'BROWSER_FORM_INVENTORY_MISMATCH',
      outputs: [Object.freeze({ contractId: 'evaluation-browser-evidence', record: Object.freeze(record) })],
      evidence: [Object.freeze({ class: 'trace', contentDigest: sha256Jcs(probed.evidence) })],
    });
  } finally {
    await session.close();
  }
}

// ── Packed install journey ──────────────────────────────────────────────────

function disposableRoot(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** Refuses any archive member that escapes its root or arrives as anything but a fresh regular file. */
export function installPackedMember(root, path, bytes) {
  const normalized = normalize(path);
  if (isAbsolute(normalized) || normalized.split(/[\\/]/u).includes('..')) {
    fail('E_EVALUATION_PACKED_MEMBER_REFUSED', `Packed member ${path} escapes the installation root.`, 'A packed archive never reaches outside the root it is installed into.', { path });
  }
  const target = resolve(root, normalized);
  const inside = relative(root, target);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    fail('E_EVALUATION_PACKED_MEMBER_REFUSED', `Packed member ${path} resolves outside the installation root.`, 'Refuse the archive; a member that leaves the root is never installed.', { path });
  }
  // A path that already exists may be a symlink pointing anywhere, so it is refused rather than followed.
  if (lstatSyncSafe(target) !== null) {
    fail('E_EVALUATION_PACKED_MEMBER_REFUSED', `Packed member ${path} would overwrite an existing path.`, 'Install into a fresh disposable root; a pre-existing path may be a symlink to somewhere else.', { path });
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
  if (!lstatSync(target).isFile()) {
    fail('E_EVALUATION_PACKED_MEMBER_REFUSED', `Packed member ${path} is not a regular file.`, 'Symlinked members are refused; the installed bytes must be the archive bytes.', { path });
  }
  return target;
}

function lstatSyncSafe(target) {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Installs the exact declared archive into a disposable root and exercises the
 * skill from the installed bytes. The working tree is never read back.
 */
export function runPackedInstallJourney({ archive, declaredMembers, exercisePath, installRoot = null }) {
  const root = installRoot ?? disposableRoot('planr-evaluation-packed');
  try {
    const installed = new Map();
    for (const [path, bytes] of Object.entries(archive).sort(([left], [right]) => left.localeCompare(right))) {
      installed.set(path, installPackedMember(root, path, bytes));
    }
    const declared = [...declaredMembers].sort();
    const present = [...installed.keys()].sort();
    if (JSON.stringify(declared) !== JSON.stringify(present)) {
      return journeyResult({
        driver: 'packed-install',
        permissionPrompts: 0,
        latencyMs: 0,
        completed: false,
        terminalReason: 'PACKED_MEMBERSHIP_MISMATCH',
      });
    }
    const target = installed.get(exercisePath);
    if (target === undefined) {
      return journeyResult({
        driver: 'packed-install',
        permissionPrompts: 0,
        latencyMs: 0,
        absence: absence('fixture-unavailable', 'The declared skill asset is absent from the installed archive.', 'refresh-fixture'),
        terminalReason: 'PACKED_ASSET_ABSENT',
      });
    }
    const installedBytes = readFileSync(target, 'utf8');
    return journeyResult({
      driver: 'packed-install',
      permissionPrompts: 0,
      latencyMs: 0,
      completed: installedBytes === archive[exercisePath],
      terminalReason: installedBytes === archive[exercisePath] ? 'PACKED_BYTES_EXERCISED' : 'PACKED_BYTES_DIVERGED',
      outputs: [Object.freeze({
        contractId: 'evaluation-packed-install',
        record: Object.freeze({ members: present.length, exercisedDigest: evaluationContentDigest(installedBytes) }),
      })],
    });
  } finally {
    if (installRoot === null) rmSync(root, { recursive: true, force: true });
  }
}

// ── Recovery journey ────────────────────────────────────────────────────────

/**
 * A disposable append-only store with an injected clock.
 * Exact replay under one identity is idempotent; changed input under the same
 * identity is a typed conflict rather than a silent overwrite.
 */
export function createDisposableStore({ root, clock }) {
  const file = join(root, 'store.json');
  const load = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { records: [] };
    }
  };
  const save = (state) => writeFileSync(file, `${JSON.stringify(state)}\n`);
  return Object.freeze({
    append(identity, payload) {
      const state = load();
      const existing = state.records.find((record) => record.identity === identity);
      const payloadDigest = sha256Jcs(payload);
      if (existing) {
        if (existing.payloadDigest !== payloadDigest) {
          fail('E_EVALUATION_JOURNEY_CONFLICT', `Identity ${identity} already carries different input.`, 'Replay the exact input or use a new identity; a changed payload under one identity is a conflict.', { identity });
        }
        return Object.freeze({ applied: false, payloadDigest });
      }
      state.records.push({ identity, payloadDigest, at: clock() });
      save(state);
      return Object.freeze({ applied: true, payloadDigest });
    },
    rollbackTo(count) {
      const state = load();
      state.records = state.records.slice(0, count);
      save(state);
      return state.records.length;
    },
    snapshot: () => load().records.length,
    reopen: () => load().records.length,
    boundInput: (identity) => load().records.find((record) => record.identity === identity)?.payloadDigest ?? null,
  });
}

/**
 * Drives stale state, a conflicting identity, crash and restart, exact replay,
 * and rollback against a disposable store and an injected clock.
 */
export function runRecoveryJourney({ scenario, clock }) {
  const root = disposableRoot('planr-evaluation-recovery');
  try {
    const store = createDisposableStore({ root, clock });
    const identity = scenario.scenarioId;
    const payload = { scenarioDigest: scenario.scenarioDigest, hostProfileDigest: scenario.hostProfileRef.hostProfileDigest };
    const steps = [];

    steps.push({ step: 'append', applied: store.append(identity, payload).applied });
    steps.push({ step: 'exact-replay', applied: store.append(identity, payload).applied });

    let conflict = null;
    try {
      store.append(identity, { ...payload, hostProfileDigest: scenario.budgetRef.budgetDigest });
    } catch (error) {
      conflict = error instanceof PipelineError ? error.code : null;
    }
    steps.push({ step: 'conflict', code: conflict });

    const before = store.snapshot();
    const reopened = createDisposableStore({ root, clock }).reopen();
    steps.push({ step: 'crash-restart', survived: reopened === before });

    const stale = store.boundInput(identity) !== sha256Jcs({ ...payload, hostProfileDigest: scenario.budgetRef.budgetDigest });
    steps.push({ step: 'stale-rejected', stale });

    const rolledBack = store.rollbackTo(0);
    steps.push({ step: 'rollback', remaining: rolledBack });

    const idempotent = steps[0].applied === true && steps[1].applied === false;
    const completed = idempotent && conflict === 'E_EVALUATION_JOURNEY_CONFLICT' && reopened === before && stale && rolledBack === 0;
    return journeyResult({
      driver: 'recovery',
      permissionPrompts: 0,
      latencyMs: 0,
      retries: 1,
      completed,
      terminalReason: completed ? 'RECOVERY_SEQUENCE_PROVEN' : 'RECOVERY_SEQUENCE_INCOMPLETE',
      outputs: [Object.freeze({ contractId: 'evaluation-recovery-trace', record: Object.freeze({ steps: steps.length, conflictCode: conflict }) })],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Disposable working root for the CLI driver, so no journey reads the caller's project. */
export function createDisposableCliRoot() {
  const root = disposableRoot('planr-evaluation-cli');
  return Object.freeze({ root, dispose: () => rmSync(root, { recursive: true, force: true }) });
}
