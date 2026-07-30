import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import { parseFrontmatter, splitFrontmatter } from '../dashboard/graph-reader.mjs';
import { buildGraph } from '../dashboard/graph-engine.mjs';
import { validateProtocolArtifact as validateCanonicalProtocolArtifact } from '../protocol/contracts.mjs';
import { canonicalizeJson } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';
import { appendProvenanceEvent, createProvenanceEvent } from './provenance.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

export const GUIDED_INTERACTION_CONTRACTS = Object.freeze({
  'guided-question': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
  'guided-questionnaire': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
  'guided-answer-envelope': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
  'guided-session': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
  'guided-confirmation': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
  'structured-action': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
  'evidence-diagnostic': Object.freeze({ protocolVersion: '1.2.0', schemaVersion: '1.0.0' }),
});

const GUIDED_ANSWER_VALUE_TYPES = Object.freeze({
  text: 'string',
  secret: 'string',
  'single-select': 'string',
  path: 'string',
  confirmation: 'boolean',
  'multi-select': 'string-array',
  'repeated-text': 'string-array',
});
const GUIDED_ANSWER_COPY_FIELDS = Object.freeze([
  'questionId',
  'questionVersion',
  'sensitivity',
]);

function guidedContract(kind) {
  const contract = GUIDED_INTERACTION_CONTRACTS[kind];
  if (!contract) {
    throw new PipelineError(
      'E_GUIDED_INTERACTION_KIND_INVALID',
      `Unsupported guided interaction artifact kind: ${kind}`,
    );
  }
  return contract;
}

export function validateGuidedInteractionArtifact(kind, value, options = {}) {
  const contract = guidedContract(kind);
  const protocolVersion = options.protocolVersion ?? value?.protocolVersion ?? contract.protocolVersion;
  if (protocolVersion !== contract.protocolVersion) {
    return [{
      path: '$.protocolVersion',
      rule: 'version',
      detail: `${kind} supports Protocol ${contract.protocolVersion}, not ${protocolVersion}`,
    }];
  }
  const errors = validateCanonicalProtocolArtifact(kind, value, { protocolVersion });
  if (errors.length) return errors;

  const duplicateIds = (records, key) => {
    const seen = new Set();
    return records.find((record) => {
      const id = record?.[key];
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    })?.[key];
  };
  if (kind === 'guided-question' && value.choices) {
    const duplicate = duplicateIds(value.choices, 'id');
    if (duplicate) errors.push({
      path: '$.choices',
      rule: 'uniqueChoiceId',
      detail: `duplicate choice id ${duplicate}`,
    });
  }
  if (kind === 'guided-questionnaire') {
    const duplicate = duplicateIds(value.questions, 'questionId');
    if (duplicate) errors.push({
      path: '$.questions',
      rule: 'uniqueQuestionId',
      detail: `duplicate question id ${duplicate}`,
    });
    if (value.step > value.totalSteps) errors.push({
      path: '$.step',
      rule: 'stepRange',
      detail: `step ${value.step} exceeds totalSteps ${value.totalSteps}`,
    });
    if (value.submission) {
      const bindings = {
        sessionId: value.sessionId,
        questionnaireVersion: value.questionnaireVersion,
        command: value.command,
        projectIdentity: value.projectIdentity,
        projectHead: value.projectHead,
        configHead: value.configHead,
        adapter: value.adapter,
      };
      for (const [field, expected] of Object.entries(bindings)) {
        if (
          canonicalizeJson(value.submission.envelope.fixedFields[field])
          !== canonicalizeJson(expected)
        ) errors.push({
          path: `$.submission.envelope.fixedFields.${field}`,
          rule: 'exactQuestionnaireBinding',
          detail: `${field} must match the questionnaire`,
        });
      }
      const expectedArgv = [
        'planr',
        'operate',
        'init',
        '--resume',
        value.sessionId,
        '--stdin',
        '--json',
      ];
      if (JSON.stringify(value.submission.transport.argv) !== JSON.stringify(expectedArgv)) {
        errors.push({
          path: '$.submission.transport.argv',
          rule: 'exactSubmissionCommand',
          detail: 'submission argv must resume this questionnaire session',
        });
      }
      const expectedAnswers = value.questions
        .filter(({ type }) => type !== 'informational')
        .map((question) => ({
          questionId: question.questionId,
          questionVersion: question.questionVersion,
          sensitivity: question.sensitivity,
          required: question.required,
          valueType: GUIDED_ANSWER_VALUE_TYPES[question.type],
        }));
      if (
        JSON.stringify(value.submission.envelope.dynamicFields.answers.items)
        !== JSON.stringify(expectedAnswers)
      ) errors.push({
        path: '$.submission.envelope.dynamicFields.answers.items',
        rule: 'exactAnswerDescriptors',
        detail: 'answer descriptors must match the ordered answerable questions',
      });
      if (
        JSON.stringify(value.submission.envelope.dynamicFields.answers.copyFields)
        !== JSON.stringify(GUIDED_ANSWER_COPY_FIELDS)
      ) errors.push({
        path: '$.submission.envelope.dynamicFields.answers.copyFields',
        rule: 'exactAnswerCopyFields',
        detail: 'answer copy fields must match the guided answer envelope schema',
      });
    }
  }
  if (kind === 'guided-answer-envelope') {
    const duplicate = duplicateIds(value.answers, 'questionId');
    if (duplicate) errors.push({
      path: '$.answers',
      rule: 'uniqueQuestionId',
      detail: `duplicate answer for question ${duplicate}`,
    });
  }
  if (kind === 'evidence-diagnostic' && value.classification) {
    for (const field of ['ruleId', 'contentDigest', 'projectHead']) {
      if (value.classification[field] !== value[field]) errors.push({
        path: `$.classification.${field}`,
        rule: 'exactEvidenceBinding',
        detail: `${field} must match the diagnosed candidate`,
      });
    }
  }
  return errors;
}

export function normalizeGuidedInteractionArtifact(kind, value) {
  const contract = guidedContract(kind);
  const normalized = {
    ...structuredClone(value ?? {}),
    kind,
    schemaVersion: value?.schemaVersion ?? contract.schemaVersion,
    protocolVersion: value?.protocolVersion ?? contract.protocolVersion,
  };
  const errors = validateGuidedInteractionArtifact(kind, normalized);
  if (errors.length) {
    throw new PipelineError(
      'E_GUIDED_INTERACTION_INVALID',
      `${kind}: ${errors[0].path} ${errors[0].detail}`,
    );
  }
  return normalized;
}

export const validateGuidedQuestion = (value, options) =>
  validateGuidedInteractionArtifact('guided-question', value, options);
export const validateGuidedQuestionnaire = (value, options) =>
  validateGuidedInteractionArtifact('guided-questionnaire', value, options);
export const validateGuidedAnswerEnvelope = (value, options) =>
  validateGuidedInteractionArtifact('guided-answer-envelope', value, options);
export const validateGuidedSession = (value, options) =>
  validateGuidedInteractionArtifact('guided-session', value, options);
export const validateGuidedConfirmation = (value, options) =>
  validateGuidedInteractionArtifact('guided-confirmation', value, options);
export const validateStructuredAction = (value, options) =>
  validateGuidedInteractionArtifact('structured-action', value, options);
export const validateEvidenceDiagnostic = (value, options) =>
  validateGuidedInteractionArtifact('evidence-diagnostic', value, options);

function slugify(value) {
  const slug = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new PipelineError('E_FEATURE_INVALID', 'A non-empty feature slug is required.');
  return slug;
}

export function detectPipelineMode(projectRoot) {
  const configPath = join(projectRoot, '.planr', 'config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      if (String(config?.idPrefix?.spec ?? '').trim()) return 'spec-driven';
    } catch (error) {
      throw new PipelineError('E_CONFIG_INVALID', `Could not parse ${configPath}: ${error.message}`);
    }
  }
  return 'default';
}

function nextSpecId(projectRoot) {
  const specsRoot = join(projectRoot, '.planr', 'specs');
  if (!existsSync(specsRoot)) return 'SPEC-001';
  const numbers = readdirSync(specsRoot)
    .map((name) => name.match(/^SPEC-(\d{3})-/)?.[1])
    .filter(Boolean)
    .map(Number);
  return `SPEC-${String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(3, '0')}`;
}

function resolveSpecDir(projectRoot, slug) {
  const specsRoot = join(projectRoot, '.planr', 'specs');
  if (!existsSync(specsRoot)) return null;
  const match = readdirSync(specsRoot).sort().find((name) => new RegExp(`^SPEC-\\d{3}-${slug}$`).test(name));
  return match ? join(specsRoot, match) : null;
}

function scaffoldSpec(projectRoot, slug) {
  const id = nextSpecId(projectRoot);
  const specDir = join(projectRoot, '.planr', 'specs', `${id}-${slug}`);
  for (const child of ['stories', 'tasks', 'design']) mkdirSync(join(specDir, child), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const content = `---\nid: "${id}"\ntitle: "${slug.replace(/-/g, ' ')}"\nslug: "${slug}"\nschemaVersion: "1.0.0"\nstatus: "shaping"\npriority: "P2"\ncreated: "${today}"\nupdated: "${today}"\nui_files: []\ntech_dependencies: []\n---\n\n# Context\n\n# Functional Requirements\n\n# Business Rules\n\n# Acceptance Criteria\n`;
  const specPath = join(specDir, `${id}-${slug}.md`);
  writeFileSync(specPath, content);
  return { id, specDir, specPath };
}

function scaffoldStack(projectRoot) {
  const stackPath = join(projectRoot, 'input', 'tech', 'stack.md');
  if (existsSync(stackPath)) return false;
  mkdirSync(dirname(stackPath), { recursive: true });
  writeFileSync(stackPath, '# Technical Stack\n\n- Project: TODO\n- Language: TODO\n- Framework: TODO\n- ORM: TODO\n- BuildCommand: TODO\n- TestCommand: TODO\n');
  return true;
}

export function preparePlan({ projectRoot = process.cwd(), feature, scaffold = false, createStackTemplate = false } = {}) {
  const slug = slugify(feature);
  const mode = detectPipelineMode(projectRoot);
  const stackTemplateCreated = createStackTemplate ? scaffoldStack(projectRoot) : false;
  if (mode === 'spec-driven') {
    let specDir = resolveSpecDir(projectRoot, slug);
    let scaffolded = null;
    if (!specDir && scaffold) {
      scaffolded = scaffoldSpec(projectRoot, slug);
      specDir = scaffolded.specDir;
    }
    return {
      ok: true,
      phase: 'plan.prepared',
      mode,
      slug,
      specDir,
      scaffolded: Boolean(scaffolded),
      stackTemplateCreated,
      requiresRuntime: true,
      requiresHumanReviewBeforeShip: true,
    };
  }
  const featureDir = join(projectRoot, 'output', 'feats', `feat-${slug}`);
  return {
    ok: true,
    phase: 'plan.prepared',
    mode,
    slug,
    featureDir,
    specPath: join(projectRoot, 'input', 'specs', `spec-${slug}.md`),
    stackTemplateCreated,
    requiresRuntime: true,
    requiresHumanReviewBeforeShip: true,
  };
}

function walkFiles(dir, predicate, acc = []) {
  if (!dir || !existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, acc);
    else if (entry.isFile() && predicate(entry.name)) acc.push(full);
  }
  return acc;
}

function featureRoot(prepared) {
  return prepared.mode === 'spec-driven' ? prepared.specDir : prepared.featureDir;
}

function artifactInfo(path) {
  const text = readFileSync(path, 'utf8');
  const split = splitFrontmatter(text);
  return { path, text, body: split.body, frontmatter: parseFrontmatter(split.raw) };
}

function specArtifact(root, mode) {
  const candidates = walkFiles(root, (name) => mode === 'spec-driven' ? /^SPEC-.*\.md$/.test(name) : /^spec-.*\.md$/.test(name));
  return candidates[0] ? artifactInfo(candidates[0]) : null;
}

export function completePlan({ projectRoot = process.cwd(), feature, runtime = 'unknown', runId = randomUUID() } = {}) {
  const prepared = preparePlan({ projectRoot, feature });
  const root = featureRoot(prepared);
  if (!root) throw new PipelineError('E_SPEC_MISSING', `No spec exists for "${prepared.slug}".`, `Run PLAN again to scaffold the spec.`);
  const stories = walkFiles(root, (name) => /^US-.*\.md$/i.test(name));
  const tasks = walkFiles(root, (name) => /^(?:T-|task-).*\.md$/i.test(name) && !/error-report/i.test(name));
  if (stories.length === 0 || tasks.length === 0) {
    throw new PipelineError('E_PLAN_INCOMPLETE', 'PLAN did not produce both stories and tasks.', 'Complete PO decomposition before marking PLAN complete.');
  }
  const spec = specArtifact(root, prepared.mode);
  const artifactId = spec?.frontmatter?.id ?? `FEAT-${prepared.slug}`;
  if (spec) {
    appendProvenanceEvent(projectRoot, createProvenanceEvent({
      projectRoot,
      artifactId,
      artifactPath: spec.path,
      operation: 'decomposed',
      product: 'planr-pipeline',
      version: pkg.version,
      runtime,
      phase: 'po',
      runId,
    }));
  }
  return { ok: true, phase: 'plan.complete', mode: prepared.mode, slug: prepared.slug, stories: stories.length, tasks: tasks.length, requiresHumanReviewBeforeShip: true };
}

function sectionList(body, heading) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => new RegExp(`^#{2,4}\\s+${heading}\\s*$`, 'i').test(line.trim()));
  if (start === -1) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (/^#{1,4}\s+/.test(lines[index])) break;
    const match = lines[index].match(/^\s*-\s+`?([^`]+?)`?\s*$/);
    if (match) out.push(match[1].trim());
  }
  return out;
}

function sha256(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function taskRecords(root, projectRoot) {
  return walkFiles(root, (name) => /^(?:T-|task-).*\.md$/i.test(name) && !/error-report/i.test(name))
    .sort()
    .map((path) => {
      const artifact = artifactInfo(path);
      const preserve = sectionList(artifact.body, 'Preserve');
      return {
        id: artifact.frontmatter.id ?? basename(path, '.md'),
        path,
        status: artifact.frontmatter.status ?? 'pending',
        dependsOn: Array.isArray(artifact.frontmatter.dependsOn) ? artifact.frontmatter.dependsOn : [],
        preserve,
        preserveHashes: Object.fromEntries(preserve.map((item) => [item, sha256(join(projectRoot, item))])),
      };
    });
}

export function prepareShip({ projectRoot = process.cwd(), feature, humanReviewConfirmed = false } = {}) {
  if (!humanReviewConfirmed) {
    throw new PipelineError('E_R1_REVIEW_REQUIRED', 'SHIP requires explicit human review after PLAN.', 'Review the generated stories/tasks, then invoke SHIP separately.');
  }
  const prepared = preparePlan({ projectRoot, feature });
  const root = featureRoot(prepared);
  if (!root) throw new PipelineError('E_SPEC_MISSING', `No planned feature exists for "${prepared.slug}".`);
  const stories = walkFiles(root, (name) => /^US-.*\.md$/i.test(name));
  const tasks = taskRecords(root, projectRoot);
  if (stories.length === 0) throw new PipelineError('E_R1_MISSING_STORIES', 'SHIP requires at least one reviewed user story.');
  if (tasks.length === 0) throw new PipelineError('E_TASKS_MISSING', 'SHIP requires at least one task.');
  return { ok: true, phase: 'ship.prepared', mode: prepared.mode, slug: prepared.slug, root, tasks };
}

export function nextShipBatch(tasks) {
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
  const pending = tasks.filter((task) => !['done', 'blocked'].includes(task.status));
  const ready = pending.filter((task) => task.dependsOn.every((dependency) => done.has(dependency)));
  const blocked = tasks.filter((task) => task.status === 'blocked');
  return {
    ready,
    blocked,
    complete: pending.length === 0,
    deadlocked: pending.length > 0 && ready.length === 0,
  };
}

function atomicWrite(path, content) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

function updateTaskStatus(path, status) {
  const text = readFileSync(path, 'utf8');
  const next = /^status:\s*.*$/m.test(text)
    ? text.replace(/^status:\s*.*$/m, `status: "${status}"`)
    : text.replace(/^---\n/, `---\nstatus: "${status}"\n`);
  atomicWrite(path, next);
}

function verifyPreserve(projectRoot, task) {
  const changed = [];
  for (const [path, before] of Object.entries(task.preserveHashes ?? {})) {
    const after = sha256(join(projectRoot, path));
    if (before !== after) changed.push(path);
  }
  if (changed.length) {
    throw new PipelineError('E_PRESERVE_VIOLATION', `Task ${task.id} changed Preserve paths: ${changed.join(', ')}`, 'Restore these paths before recording the task result.');
  }
}

export function recordTaskResult({ projectRoot = process.cwd(), featureRoot, task, result, startedAt, endedAt = new Date().toISOString() } = {}) {
  if (!['done', 'blocked', 'retry'].includes(result.status)) throw new PipelineError('E_TASK_STATUS_INVALID', `Unsupported task result status: ${result.status}`);
  verifyPreserve(projectRoot, task);
  const correctionPath = join(featureRoot, '.corrections.json');
  let correctionState = { schemaVersion: '1.0.0', tasks: {} };
  if (existsSync(correctionPath)) {
    try {
      correctionState = JSON.parse(readFileSync(correctionPath, 'utf8'));
    } catch (error) {
      throw new PipelineError('E_CORRECTION_STATE_INVALID', `Could not parse ${correctionPath}: ${error.message}`);
    }
  }
  const previousCorrections = Number(correctionState.tasks?.[task.id] ?? 0);
  const correctionCount = result.status === 'retry'
    ? previousCorrections + 1
    : result.status === 'blocked'
      ? Math.max(previousCorrections, 3)
      : previousCorrections;
  const effectiveStatus = result.status === 'retry'
    ? correctionCount >= 3 ? 'blocked' : 'in-progress'
    : result.status;
  correctionState.tasks = { ...correctionState.tasks, [task.id]: correctionCount };
  atomicWrite(correctionPath, `${JSON.stringify(correctionState, null, 2)}\n`);
  updateTaskStatus(task.path, effectiveStatus);
  if (effectiveStatus === 'blocked' && result.status === 'retry') {
    const reportPath = join(dirname(task.path), `${task.id}-error-report.md`);
    atomicWrite(reportPath, `# ${task.id} error report\n\nBlocked after 3 correction attempts.\n\n${result.errorSummary ?? 'Build or test verification did not pass.'}\n`);
  }
  const record = {
    stage: `ship.task:${task.id}`,
    agent: result.agent ?? null,
    started_at: startedAt ?? endedAt,
    ended_at: endedAt,
    files_written: result.filesWritten ?? [],
    files_modified: result.filesModified ?? [],
    exit_status: effectiveStatus === 'done' ? 'success' : 'failure',
    error_summary: effectiveStatus === 'done' ? null : result.errorSummary ?? 'Task requires correction.',
  };
  const errors = validateProtocolArtifact('run-manifest', record);
  if (errors.length) throw new PipelineError('E_RUN_MANIFEST_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  appendFileSync(join(featureRoot, '.run-manifest.jsonl'), `${JSON.stringify(record)}\n`);
  return {
    ...record,
    status: effectiveStatus,
    correctionCount,
    canRetry: effectiveStatus === 'in-progress' && correctionCount < 3,
  };
}

function yamlScalar(value) {
  return JSON.stringify(value);
}

function markerYaml(marker) {
  const lines = [];
  for (const [key, value] of Object.entries(marker)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function finalizeShip({
  projectRoot = process.cwd(),
  feature,
  runtime = 'unknown',
  startedAt = Date.now(),
  agentsInvoked = [],
  qaGateStatus = 'skipped',
  devopsStatus = 'skipped',
  docsStatus = 'skipped',
  snapshotStatus = 'skipped',
  errorReports = [],
  dispatchStyle,
  runId = randomUUID(),
} = {}) {
  const prepared = prepareShip({ projectRoot, feature, humanReviewConfirmed: true });
  const tasks = taskRecords(prepared.root, projectRoot);
  const failed = tasks.filter((task) => task.status === 'blocked').length;
  const executed = tasks.filter((task) => ['done', 'blocked'].includes(task.status)).length;
  const marker = {
    shipped_at: new Date().toISOString(),
    pipeline_version: pkg.version,
    runtime,
    mode: prepared.mode,
    feature: prepared.slug,
    tasks_executed: executed,
    tasks_failed: failed,
    qa_gate_status: qaGateStatus,
    duration_seconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    agents_invoked: agentsInvoked,
    devops_status: devopsStatus,
    docs_status: docsStatus,
    snapshot_status: snapshotStatus,
    error_reports: errorReports,
    ...(dispatchStyle ? { dispatch_style: dispatchStyle } : {}),
  };
  const errors = validateProtocolArtifact('pipeline-shipped', marker);
  if (errors.length) throw new PipelineError('E_SHIPPED_MARKER_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  const markerPath = join(prepared.root, '.pipeline-shipped');
  atomicWrite(markerPath, markerYaml(marker));
  const spec = specArtifact(prepared.root, prepared.mode);
  if (spec) {
    appendProvenanceEvent(projectRoot, createProvenanceEvent({
      projectRoot,
      artifactId: spec.frontmatter.id ?? `FEAT-${prepared.slug}`,
      artifactPath: spec.path,
      operation: 'shipped',
      product: 'planr-pipeline',
      version: pkg.version,
      runtime,
      phase: 'delivery',
      runId,
    }));
  }
  return { ok: true, markerPath, marker };
}

const SCHEMAS = {
  'pipeline-shipped': 'schemas/v1.0.0/pipeline-shipped.schema.json',
  'run-manifest': 'schemas/v1.0.0/run-manifest.schema.json',
  'runtime-lock': 'schemas/v1.1.0/runtime-lock.schema.json',
  'provenance-event': 'schemas/v1.1.0/provenance-event.schema.json',
  'adapter-registry': 'schemas/v1.1.0/adapter-registry.schema.json',
  'ecosystem-manifest': 'schemas/v1.1.0/ecosystem-manifest.schema.json',
};

export function validateProtocolArtifact(kind, value) {
  const schemaPath = SCHEMAS[kind];
  if (!schemaPath) throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown protocol artifact kind: ${kind}`);
  const schema = JSON.parse(readFileSync(join(packageRoot, schemaPath), 'utf8'));
  return validateJson(value, schema);
}

export function runSyncAudit({ projectRoot = process.cwd() } = {}) {
  const planrDir = join(projectRoot, '.planr');
  const graph = buildGraph(planrDir, { preferNative: true });
  const counts = Object.fromEntries(['spec', 'story', 'task', 'quick', 'backlog'].map((type) => [type, graph.nodes.filter((node) => node.type === type).length]));
  return { ok: true, readOnly: true, counts, nodes: graph.nodes.length, edges: graph.edges.length };
}
