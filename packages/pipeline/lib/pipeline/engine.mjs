import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PipelineError } from './errors.mjs';
import {
  assertBrowserQaSession,
  establishBrowserQaRuntimeCapability,
  issueBrowserQaGateRecord,
  issueBrowserQaRecordedEvent,
} from './engine/quality.mjs';
import {
  advanceStoredPlanningReview,
  decideStoredPlanningReview,
  preparePlanningReview,
  prepareStoredPlanningReviewOwnerDecision,
  readPlanningReviewReceipt,
  startStoredPlanningReview,
} from './engine/planning.mjs';
import {
  advanceStoredInvestigation,
  finalizeStoredInvestigation,
  prepareStoredInvestigationFixAuthorization,
  startStoredInvestigation,
  verifyStoredInvestigation,
} from './engine/investigation.mjs';
import {
  appendProvenanceEvent,
  assertPathCustody,
  advanceStoredShipClosure,
  BROWSER_SURFACES,
  classifyShipRisk,
  createProvenanceEvent,
  createShipClosure,
  finalizeStoredShipClosure,
  inspectStoredShipClosureForLanding,
  loadSpecOperatingOrigin,
  listShipClosureSummaries,
  normalizeRepositories,
  projectPipelineOperatingOriginCorrelation,
  projectSpecOperatingOrigin,
  readStoredShipClosure,
  reopenStoredShipClosure,
  resolveShipClosureConfiguration,
  runStoredShipGates,
  SHIP_SPECIALIST_IDS,
} from './engine/ship.mjs';
import {
  buildGraph,
  canonicalizeJson,
  normalizePlanningTask,
  parseFrontmatter,
  sha256Jcs,
  splitFrontmatter,
  validateCanonicalProtocolArtifact,
  validateJson,
} from './engine/protocol.mjs';

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
const GUIDED_ANSWER_COPY_FIELDS = Object.freeze(['questionId', 'questionVersion', 'sensitivity']);

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
  const protocolVersion =
    options.protocolVersion ?? value?.protocolVersion ?? contract.protocolVersion;
  if (protocolVersion !== contract.protocolVersion) {
    return [
      {
        path: '$.protocolVersion',
        rule: 'version',
        detail: `${kind} supports Protocol ${contract.protocolVersion}, not ${protocolVersion}`,
      },
    ];
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
    if (duplicate)
      errors.push({
        path: '$.choices',
        rule: 'uniqueChoiceId',
        detail: `duplicate choice id ${duplicate}`,
      });
  }
  if (kind === 'guided-questionnaire') {
    const duplicate = duplicateIds(value.questions, 'questionId');
    if (duplicate)
      errors.push({
        path: '$.questions',
        rule: 'uniqueQuestionId',
        detail: `duplicate question id ${duplicate}`,
      });
    if (value.step > value.totalSteps)
      errors.push({
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
          canonicalizeJson(value.submission.envelope.fixedFields[field]) !==
          canonicalizeJson(expected)
        )
          errors.push({
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
        JSON.stringify(value.submission.envelope.dynamicFields.answers.items) !==
        JSON.stringify(expectedAnswers)
      )
        errors.push({
          path: '$.submission.envelope.dynamicFields.answers.items',
          rule: 'exactAnswerDescriptors',
          detail: 'answer descriptors must match the ordered answerable questions',
        });
      if (
        JSON.stringify(value.submission.envelope.dynamicFields.answers.copyFields) !==
        JSON.stringify(GUIDED_ANSWER_COPY_FIELDS)
      )
        errors.push({
          path: '$.submission.envelope.dynamicFields.answers.copyFields',
          rule: 'exactAnswerCopyFields',
          detail: 'answer copy fields must match the guided answer envelope schema',
        });
    }
  }
  if (kind === 'guided-answer-envelope') {
    const duplicate = duplicateIds(value.answers, 'questionId');
    if (duplicate)
      errors.push({
        path: '$.answers',
        rule: 'uniqueQuestionId',
        detail: `duplicate answer for question ${duplicate}`,
      });
  }
  if (kind === 'evidence-diagnostic' && value.classification) {
    for (const field of ['ruleId', 'contentDigest', 'projectHead']) {
      if (value.classification[field] !== value[field])
        errors.push({
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
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
      throw new PipelineError(
        'E_CONFIG_INVALID',
        `Could not parse ${configPath}: ${error.message}`,
      );
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
  const match = readdirSync(specsRoot)
    .sort()
    .find((name) => new RegExp(`^SPEC-\\d{3}-${slug}$`).test(name));
  return match ? join(specsRoot, match) : null;
}

function scaffoldSpec(projectRoot, slug) {
  const id = nextSpecId(projectRoot);
  const specDir = join(projectRoot, '.planr', 'specs', `${id}-${slug}`);
  for (const child of ['stories', 'tasks', 'design'])
    mkdirSync(join(specDir, child), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const title = slug.replace(/-/g, ' ');
  const content = readFileSync(join(packageRoot, 'templates', 'spec-driven.md.tpl'), 'utf8')
    .replaceAll('{{SPEC_ID}}', id)
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{SLUG}}', slug)
    .replaceAll('{{DATE}}', today);
  const specPath = join(specDir, `${id}-${slug}.md`);
  writeFileSync(specPath, content);
  return { id, specDir, specPath };
}

function scaffoldStack(projectRoot) {
  const stackPath = join(projectRoot, 'input', 'tech', 'stack.md');
  if (existsSync(stackPath)) return false;
  mkdirSync(dirname(stackPath), { recursive: true });
  writeFileSync(stackPath, readFileSync(join(packageRoot, 'templates', 'stack.md.tpl'), 'utf8'));
  return true;
}

export function preparePlan({
  projectRoot = process.cwd(),
  feature,
  scaffold = false,
  createStackTemplate = false,
} = {}) {
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
      requiresHumanReviewBeforeShip: false,
      requiresSeparateShipInvocation: false,
      operatingOrigin: projectSpecOperatingOrigin(loadSpecOperatingOrigin(specDir)),
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
    requiresHumanReviewBeforeShip: false,
    requiresSeparateShipInvocation: false,
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

function specArtifact({ root, mode, projectRoot, slug }) {
  if (mode === 'default') {
    const path = join(projectRoot, 'input', 'specs', `spec-${slug}.md`);
    return existsSync(path) ? artifactInfo(path) : null;
  }
  const candidates = walkFiles(root, (name) => /^SPEC-.*\.md$/i.test(name));
  return candidates[0] ? artifactInfo(candidates[0]) : null;
}

function storyPaths(root, mode) {
  return walkFiles(
    root,
    (name) => /^US-.*\.md$/i.test(name) || (mode === 'default' && /^us-\d+\.md$/i.test(name)),
  );
}

function planArtifactSchemaError(
  kind,
  path,
  projectRoot,
  detail,
  errors = [],
  schemaVersion = '1.0.0',
) {
  const artifactPath = relative(projectRoot, path).split('\\').join('/');
  throw new PipelineError(
    'E_PLAN_ARTIFACT_SCHEMA',
    `${artifactPath}: ${kind} frontmatter ${detail}`,
    `Update ${artifactPath} frontmatter to match schemas/v${schemaVersion}/${kind}.schema.json.`,
    {
      artifactPath,
      artifactKind: kind,
      schemaVersion,
      errors,
    },
  );
}

function validateDeclaredPlanArtifacts(kind, paths, projectRoot, { requiredVersion = null } = {}) {
  for (const path of paths) {
    const artifact = artifactInfo(path);
    const declaredVersion = artifact.frontmatter.schemaVersion;
    if (requiredVersion !== null && declaredVersion !== requiredVersion) {
      const errors = [
        {
          path: '$.schemaVersion',
          rule: 'required',
          detail: `must equal ${requiredVersion} because the parent specification declares it`,
        },
      ];
      planArtifactSchemaError(
        kind,
        path,
        projectRoot,
        `${errors[0].path} ${errors[0].detail}`,
        errors,
        requiredVersion,
      );
    }
    if (declaredVersion === undefined) continue;
    if (!['1.0.0', '1.7.0'].includes(declaredVersion)) {
      const errors = [
        {
          path: '$.schemaVersion',
          rule: 'version',
          detail: `unsupported schema version ${declaredVersion}`,
        },
      ];
      planArtifactSchemaError(
        kind,
        path,
        projectRoot,
        `${errors[0].path} ${errors[0].detail}`,
        errors,
        declaredVersion,
      );
    }
    const errors = validateCanonicalProtocolArtifact(kind, artifact.frontmatter, {
      protocolVersion: declaredVersion,
    });
    if (errors.length === 0) continue;

    const [first] = errors;
    planArtifactSchemaError(
      kind,
      path,
      projectRoot,
      `${first.path} ${first.detail}`,
      errors,
      declaredVersion,
    );
  }
}

export function completePlan({
  projectRoot = process.cwd(),
  feature,
  runtime = 'unknown',
  runId = randomUUID(),
} = {}) {
  const prepared = preparePlan({ projectRoot, feature });
  const root = featureRoot(prepared);
  if (!root)
    throw new PipelineError(
      'E_SPEC_MISSING',
      `No spec exists for "${prepared.slug}".`,
      `Run PLAN again to scaffold the spec.`,
    );
  const stories = storyPaths(root, prepared.mode);
  const tasks = walkFiles(
    root,
    (name) => /^(?:T-|task-).*\.md$/i.test(name) && !/error-report/i.test(name),
  );
  if (stories.length === 0 || tasks.length === 0) {
    throw new PipelineError(
      'E_PLAN_INCOMPLETE',
      'PLAN did not produce both stories and tasks.',
      'Complete PO decomposition before marking PLAN complete.',
    );
  }
  const spec = specArtifact({
    root,
    mode: prepared.mode,
    projectRoot,
    slug: prepared.slug,
  });
  if (!spec) {
    const expected =
      prepared.mode === 'default'
        ? join(projectRoot, 'input', 'specs', `spec-${prepared.slug}.md`)
        : root;
    throw new PipelineError(
      'E_SPEC_MISSING',
      `No specification document exists for "${prepared.slug}" at ${relative(projectRoot, expected).split('\\').join('/') || '.'}.`,
    );
  }
  validateDeclaredPlanArtifacts('spec', [spec.path], projectRoot);
  const requiredVersion = ['1.0.0', '1.7.0'].includes(spec.frontmatter.schemaVersion)
    ? spec.frontmatter.schemaVersion
    : null;
  validateDeclaredPlanArtifacts('story', stories, projectRoot, { requiredVersion });
  validateDeclaredPlanArtifacts('task', tasks, projectRoot, { requiredVersion });
  const artifactId = spec?.frontmatter?.id ?? `FEAT-${prepared.slug}`;
  if (spec) {
    appendProvenanceEvent(
      projectRoot,
      createProvenanceEvent({
        projectRoot,
        artifactId,
        artifactPath: spec.path,
        operation: 'decomposed',
        product: 'planr-pipeline',
        version: pkg.version,
        runtime,
        phase: 'po',
        runId,
        correlation: projectPipelineOperatingOriginCorrelation(prepared.operatingOrigin ?? null),
      }),
    );
  }
  return {
    ok: true,
    phase: 'plan.complete',
    mode: prepared.mode,
    slug: prepared.slug,
    stories: stories.length,
    tasks: tasks.length,
    operatingOrigin: prepared.operatingOrigin ?? null,
    requiresHumanReviewBeforeShip: false,
    requiresSeparateShipInvocation: false,
  };
}

function planningReviewContext({ projectRoot, feature } = {}) {
  const planned = preparePlan({ projectRoot, feature });
  const root = featureRoot(planned);
  if (!root)
    throw new PipelineError('E_SPEC_MISSING', `No planned feature exists for "${planned.slug}".`);
  return preparePlanningReview({
    projectRoot,
    featureRoot: root,
    mode: planned.mode,
    slug: planned.slug,
  });
}

export function preparePlanReview({ projectRoot = process.cwd(), feature } = {}) {
  return planningReviewContext({ projectRoot, feature });
}

export function startPlanReview({
  projectRoot = process.cwd(),
  feature,
  runtime = 'unknown',
  runId,
} = {}) {
  const prepared = planningReviewContext({ projectRoot, feature });
  return startStoredPlanningReview({ prepared, runtime, runId });
}

export function advancePlanReview({ projectRoot = process.cwd(), feature, runId, event } = {}) {
  const prepared = planningReviewContext({ projectRoot, feature });
  return advanceStoredPlanningReview({ prepared, runId, event });
}

export function preparePlanReviewOwnerDecision({
  projectRoot = process.cwd(),
  feature,
  runId,
} = {}) {
  const prepared = planningReviewContext({ projectRoot, feature });
  return prepareStoredPlanningReviewOwnerDecision({ prepared, runId });
}

export function decidePlanReview({ projectRoot = process.cwd(), feature, runId, capability } = {}) {
  const prepared = planningReviewContext({ projectRoot, feature });
  return decideStoredPlanningReview({ prepared, runId, capability });
}

function sectionList(body, heading) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^#{2,4}\\s+${heading}\\s*$`, 'i').test(line.trim()),
  );
  if (start === -1) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index++) {
    if (/^#{1,4}\s+/.test(lines[index])) break;
    const match = lines[index].match(/^\s*-\s+`?([^`]+?)`?\s*$/);
    if (match) out.push(match[1].trim());
  }
  return out;
}

function taskRecords(root) {
  return walkFiles(
    root,
    (name) => /^(?:T-|task-).*\.md$/i.test(name) && !/error-report/i.test(name),
  )
    .sort()
    .map((path) => {
      const artifact = artifactInfo(path);
      const task = normalizePlanningTask(artifact.frontmatter);
      const preserve = sectionList(artifact.body, 'Preserve');
      const structuredPreserveDeclared = Object.prototype.hasOwnProperty.call(task, 'preserve');
      const structuredPreserve = structuredPreserveDeclared ? task.preserve : undefined;
      return {
        id: task.id ?? basename(path, '.md'),
        path,
        storyId: task.storyId,
        status: task.status ?? 'pending',
        type: task.type ?? 'Tech',
        reviewRisks: task.reviewRisks,
        browserSurfaces: task.browserSurfaces,
        acceptanceRefs: task.acceptanceRefs,
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
        preserve,
        structuredPreserve,
        structuredPreserveDeclared,
        legacyPreserve: preserve,
      };
    });
}

function posixPath(path) {
  return path.split('\\').join('/');
}

function scopeTaskRecords(tasks, { mode, root }) {
  const scoped = tasks.map((task) => {
    const path = posixPath(relative(root, task.path));
    const pathScope = path.includes('/tasks/')
      ? path.slice(0, path.indexOf('/tasks/'))
      : dirname(path);
    const defaultStoryPath =
      mode === 'default' ? join(root, pathScope, `${basename(pathScope)}.md`) : null;
    const inferredStoryId =
      defaultStoryPath && existsSync(defaultStoryPath)
        ? artifactInfo(defaultStoryPath).frontmatter.id
        : null;
    const storyId = task.storyId ?? inferredStoryId;
    const scope = storyId ?? pathScope;
    return {
      ...task,
      storyId,
      scope,
      selector: mode === 'default' ? `${scope}/${task.id}` : task.id,
    };
  });
  const selectors = new Set(scoped.map(({ selector }) => selector));
  return scoped.map((task) => ({
    ...task,
    dependencySelectors: task.dependsOn.map((dependency) => {
      if (mode !== 'default' || selectors.has(dependency)) return dependency;
      return `${task.scope}/${dependency}`;
    }),
  }));
}

function configuredShipRepositories(projectRoot) {
  return configuredShipClosure(projectRoot, { ignoreGates: true }).repositories;
}

function ordinaryShipRepositories(projectRoot) {
  const fallback = [{ repositoryKey: 'project', root: projectRoot }];
  try {
    const configured = configuredShipClosure(projectRoot);
    return {
      repositories: configured.repositories ?? fallback,
      diagnostics: [],
    };
  } catch (error) {
    if (
      !(error instanceof PipelineError) ||
      !['E_SHIP_CONFIG_INVALID', 'E_SHIP_REPOSITORY_INVALID', 'E_SHIP_GATE_INVALID'].includes(
        error.code,
      )
    )
      throw error;
    return {
      repositories: fallback,
      diagnostics: [
        {
          code: error.code,
          message: error.message,
          recovery:
            'Ordinary Ship is using the current project only. Repair shipClosure before running release commands.',
        },
      ],
    };
  }
}

function configuredShipGates(projectRoot) {
  return configuredShipClosure(projectRoot).gates;
}

function configuredShipClosure(projectRoot, { ignoreGates = false } = {}) {
  const configPath = join(projectRoot, '.planr', 'config.json');
  if (!existsSync(configPath)) return { repositories: undefined, gates: undefined };
  assertPathCustody(projectRoot, configPath, { expectedKind: 'file' });
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new PipelineError(
      'E_CONFIG_INVALID',
      `${configPath} is not valid JSON: ${error.message}`,
    );
  }
  const closure = config?.shipClosure;
  if (
    closure !== undefined &&
    (closure === null ||
      typeof closure !== 'object' ||
      Array.isArray(closure) ||
      Object.keys(closure).some((key) => !['repositories', 'gates'].includes(key)))
  ) {
    throw new PipelineError(
      'E_SHIP_CONFIG_INVALID',
      'config.shipClosure is closed and accepts only repositories and gates.',
    );
  }
  const descriptors = closure?.repositories;
  let records;
  if (descriptors === undefined) {
    records = undefined;
  } else if (!Array.isArray(descriptors) || descriptors.length === 0 || descriptors.length > 16) {
    throw new PipelineError(
      'E_SHIP_REPOSITORY_INVALID',
      'config.shipClosure.repositories must contain 1-16 closed repository descriptors.',
    );
  } else
    records = descriptors.map((descriptor) => {
      if (
        descriptor === null ||
        typeof descriptor !== 'object' ||
        Array.isArray(descriptor) ||
        JSON.stringify(Object.keys(descriptor).sort()) !== JSON.stringify(['path', 'repositoryKey'])
      ) {
        throw new PipelineError(
          'E_SHIP_REPOSITORY_INVALID',
          'Each configured SHIP repository must contain exactly repositoryKey and path.',
        );
      }
      if (
        !/^[a-z][a-z0-9-]{0,127}$/.test(descriptor.repositoryKey ?? '') ||
        typeof descriptor.path !== 'string' ||
        descriptor.path.length === 0 ||
        descriptor.path.length > 1024 ||
        descriptor.path.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(descriptor.path)
      ) {
        throw new PipelineError(
          'E_SHIP_REPOSITORY_INVALID',
          'Configured SHIP repositories require a bounded slug key and relative filesystem path.',
        );
      }
      return {
        repositoryKey: descriptor.repositoryKey,
        root: resolve(projectRoot, descriptor.path),
      };
    });
  if (
    records &&
    (new Set(records.map(({ repositoryKey }) => repositoryKey)).size !== records.length ||
      !records.some(
        ({ repositoryKey, root }) =>
          repositoryKey === 'project' && resolve(root) === resolve(projectRoot),
      ))
  ) {
    throw new PipelineError(
      'E_SHIP_REPOSITORY_INVALID',
      'Configured SHIP repositories must be unique and include project at path ".".',
    );
  }
  const gates = ignoreGates ? undefined : closure?.gates;
  if (gates !== undefined && (!Array.isArray(gates) || gates.length === 0 || gates.length > 32)) {
    throw new PipelineError(
      'E_SHIP_GATE_INVALID',
      'config.shipClosure.gates must contain 1-32 closed gate records.',
    );
  }
  return { repositories: records, gates: gates === undefined ? undefined : structuredClone(gates) };
}

function assertShipPlanningCustody(projectRoot) {
  for (const path of [
    join(projectRoot, '.planr'),
    join(projectRoot, '.planr', 'specs'),
    join(projectRoot, 'output'),
    join(projectRoot, 'output', 'feats'),
  ])
    assertPathCustody(projectRoot, path, { allowMissing: true, expectedKind: 'directory' });
}

function prepareShipRunContext({ projectRoot, feature, includeTasks = false } = {}) {
  assertShipPlanningCustody(projectRoot);
  const planned = preparePlan({ projectRoot, feature });
  const root = featureRoot(planned);
  if (!root)
    throw new PipelineError('E_SPEC_MISSING', `No planned feature exists for "${planned.slug}".`);
  const repositoryInputs = configuredShipRepositories(projectRoot) ?? [
    { repositoryKey: 'project', root: projectRoot },
  ];
  const closureRepositories = normalizeRepositories(projectRoot, repositoryInputs);
  return {
    ...planned,
    root,
    projectRoot,
    closureRepositories,
    repositoryInputs,
    ...(includeTasks ? { tasks: taskRecords(root) } : {}),
  };
}

/** Prepares ordinary implementation context without initializing release closure state or gates. */
export function prepareShipContext({ projectRoot = process.cwd(), feature, taskId } = {}) {
  assertShipPlanningCustody(projectRoot);
  const prepared = preparePlan({ projectRoot, feature });
  const root =
    featureRoot(prepared) ?? join(projectRoot, '.planr', 'specs', `SPEC-NNN-${prepared.slug}`);
  const diagnostics = [];
  if (!existsSync(root))
    diagnostics.push({
      code: 'E_SPEC_MISSING',
      message: `No planned feature directory exists for "${prepared.slug}".`,
      recovery:
        'The Ship skill can inspect the repository and continue from the user request; run Plan first when structured artifacts are wanted.',
    });
  const stories = storyPaths(root, prepared.mode);
  const allTasks = scopeTaskRecords(taskRecords(root), { mode: prepared.mode, root });
  const sourceDone = new Set(
    allTasks.filter(({ status }) => status === 'done').map(({ selector }) => selector),
  );
  let tasks = allTasks
    .filter(({ status }) => status !== 'done')
    .map((task) => {
      const unresolvedDependencies = task.dependsOn
        .map((dependency, index) => ({ dependency, selector: task.dependencySelectors[index] }))
        .filter(({ selector }) => !sourceDone.has(selector));
      return {
        ...task,
        dependsOn: unresolvedDependencies.map(({ dependency }) => dependency),
        dependencySelectors: unresolvedDependencies.map(({ selector }) => selector),
      };
    });
  if (taskId !== undefined) {
    const qualifiedMatches = allTasks.filter(({ selector }) => selector === taskId);
    const matches = qualifiedMatches.length
      ? qualifiedMatches
      : allTasks.filter(({ id }) => id === taskId);
    if (matches.length === 0) {
      const searchedRoot = relative(projectRoot, root).split('\\').join('/') || '.';
      const candidates = allTasks.map(({ id, selector, storyId, path }) => ({
        id,
        selector,
        storyId: storyId ?? null,
        path: relative(root, path).split('\\').join('/'),
      }));
      throw new PipelineError(
        'E_TASK_UNKNOWN',
        `Unknown task ${taskId} for ${prepared.slug}. Searched ${searchedRoot}. Available tasks: ${candidates.map(({ selector, path }) => `${selector} at ${path}`).join('; ') || 'none'}.`,
        'Choose one available task selector or omit --task to hand off the full available scope.',
        { taskId, searchedRoot, candidates },
      );
    }
    if (matches.length > 1) {
      const candidates = matches.map(({ storyId, path, selector }) => ({
        storyId: storyId ?? null,
        path: relative(root, path).split('\\').join('/'),
        selector,
      }));
      throw new PipelineError(
        'E_TASK_AMBIGUOUS',
        `Task ${taskId} matches multiple story-scoped tasks for ${prepared.slug}: ${candidates.map(({ selector, path }) => `${selector} at ${path}`).join('; ')}.`,
        `Select one candidate with --task <story>/<task>, for example --task ${candidates[0].selector}.`,
        { taskId, candidates },
      );
    }
    const [selected] = matches;
    if (selected.status === 'done') {
      throw new PipelineError(
        'E_TASK_ALREADY_DONE',
        `Task ${taskId} is already complete; choose an active task or update the planning context for rework.`,
      );
    }
    const externalIncomplete = selected.dependencySelectors.filter(
      (dependency) => allTasks.find(({ selector }) => selector === dependency)?.status !== 'done',
    );
    if (externalIncomplete.length) {
      throw new PipelineError(
        'E_TASK_DEPENDENCY',
        `Single-task SHIP cannot select ${taskId} before dependencies complete: ${externalIncomplete.join(', ')}.`,
      );
    }
    tasks = [{ ...selected, dependsOn: [], dependencySelectors: [] }];
  }
  if (stories.length === 0)
    diagnostics.push({
      code: 'E_R1_MISSING_STORIES',
      message: 'No planned user stories were found.',
      recovery:
        'The Ship skill will continue with the available specification and repository context.',
    });
  if (allTasks.length === 0)
    diagnostics.push({
      code: 'E_TASKS_MISSING',
      message: 'No planned tasks were found.',
      recovery:
        'The Ship skill will continue with the available specification and repository context.',
    });
  const unresolved = tasks.filter(({ status }) => status !== 'done');
  const initialReadyTasks = nextShipBatch(
    tasks.map((task) => (task.status === 'blocked' ? { ...task, status: 'pending' } : task)),
  ).ready;
  const initialReadyTaskIds = initialReadyTasks.map(({ id }) => id);
  const initialReadyTaskSelectors = initialReadyTasks.map(({ selector }) => selector);
  const ordinaryRepositories = ordinaryShipRepositories(projectRoot);
  const repositories = ordinaryRepositories.repositories;
  diagnostics.push(...ordinaryRepositories.diagnostics);
  const repositoryDescriptors = repositories.map(({ repositoryKey, root: repositoryRoot }) => ({
    repositoryKey,
    path: relative(projectRoot, repositoryRoot).split('\\').join('/') || '.',
  }));
  const context = {
    ok: true,
    phase: 'ship.prepared',
    mode: prepared.mode,
    slug: prepared.slug,
    unresolvedTasks: unresolved.map(
      ({
        id,
        selector,
        storyId,
        status,
        dependsOn,
        dependencySelectors,
        reviewRisks,
        browserSurfaces,
        acceptanceRefs,
        structuredPreserve,
        structuredPreserveDeclared,
        legacyPreserve,
      }) => ({
        id,
        selector,
        storyId,
        sourceStatus: status,
        dependsOn,
        dependencySelectors,
        reviewRisks,
        browserSurfaces,
        acceptanceRefs,
        structuredPreserve: structuredPreserveDeclared ? structuredPreserve : null,
        preserveSource: structuredPreserveDeclared
          ? 'structured'
          : legacyPreserve.length > 0
            ? 'legacy'
            : 'none',
      }),
    ),
    initialReadyTaskIds,
    initialReadyTaskSelectors,
    dependencyEdges: tasks.flatMap(({ id, selector, dependsOn, dependencySelectors }) =>
      dependsOn.map((dependencyId, index) => ({
        dependencyId,
        taskId: id,
        dependencySelector: dependencySelectors[index],
        taskSelector: selector,
      })),
    ),
    parentReferences: [...new Set(tasks.map(({ storyId }) => storyId).filter(Boolean))],
    repositoryDescriptors,
    selectedTaskId: taskId ?? null,
    selectedTaskSelector: tasks.length === 1 && taskId !== undefined ? tasks[0].selector : null,
    operatingOrigin: prepared.operatingOrigin ?? null,
    diagnostics,
  };
  Object.defineProperties(context, {
    projectRoot: { value: projectRoot, enumerable: false },
    root: { value: root, enumerable: false },
    tasks: { value: tasks, enumerable: false },
    allTasks: { value: allTasks, enumerable: false },
  });
  return context;
}

export function prepareShip({ projectRoot = process.cwd(), feature, taskId } = {}) {
  const context = prepareShipContext({ projectRoot, feature, taskId });
  const planningProblem = context.diagnostics.find(({ code }) =>
    ['E_SPEC_MISSING', 'E_R1_MISSING_STORIES', 'E_TASKS_MISSING'].includes(code),
  );
  if (planningProblem) {
    throw new PipelineError(
      planningProblem.code,
      planningProblem.message,
      planningProblem.recovery,
    );
  }
  const configured = configuredShipClosure(projectRoot);
  const closureRepositories = normalizeRepositories(projectRoot, configured.repositories);
  const closureSummaries = listShipClosureSummaries({
    featureRoot: context.root,
    projectRoot,
    feature: context.slug,
    mode: context.mode,
    closureRepositories,
  });
  const priorClosure =
    closureSummaries.active[0] ??
    [...closureSummaries.terminal]
      .sort(
        (left, right) =>
          left.terminal.at.localeCompare(right.terminal.at) ||
          left.runId.localeCompare(right.runId),
      )
      .at(-1);
  const resolvedClosure = priorClosure
    ? { repositories: closureRepositories, gates: priorClosure.gates }
    : resolveShipClosureConfiguration({
        projectRoot,
        repositories: configured.repositories,
        gates: configured.gates,
      });
  const preview = {
    ...context,
    phase: 'ship.prepared',
    gateDescriptors: resolvedClosure.gates.map((gate) => structuredClone(gate)),
    closure: {
      activeRunIds: closureSummaries.active.map(({ runId }) => runId),
      terminalRunIds: closureSummaries.terminal.map(({ runId }) => runId),
      active: closureSummaries.active,
      terminal: closureSummaries.terminal,
    },
  };
  Object.defineProperties(preview, {
    projectRoot: { value: projectRoot, enumerable: false },
    closureRepositories: { value: resolvedClosure.repositories, enumerable: false },
    root: { value: context.root, enumerable: false },
    tasks: { value: context.tasks, enumerable: false },
    allTasks: { value: context.allTasks, enumerable: false },
  });
  return preview;
}

export function startShip({
  projectRoot = process.cwd(),
  feature,
  runtime = 'unknown',
  taskId,
  repositories,
  reviewerRoster,
  gates,
  runId,
  planningReviewReceiptHash,
} = {}) {
  const planned = preparePlan({ projectRoot, feature });
  const root = featureRoot(planned);
  if (!root)
    throw new PipelineError('E_SPEC_MISSING', `No planned feature exists for "${planned.slug}".`);
  const currentSpec = specArtifact({
    root,
    mode: planned.mode,
    projectRoot,
    slug: planned.slug,
  });
  let planningReview = null;
  if (planningReviewReceiptHash !== undefined) {
    const reviewPrepared = planningReviewContext({ projectRoot, feature });
    const receipt = readPlanningReviewReceipt({
      prepared: reviewPrepared,
      receiptHash: planningReviewReceiptHash,
    });
    planningReview = {
      receiptHash: receipt.receiptHash,
      planDigest: receipt.candidateRevisions.at(-1).planDigest,
      ownerDecisionDigest: receipt.ownerDecision.decisionDigest,
    };
  }
  const prepared = prepareShip({ projectRoot, feature, taskId });
  if (prepared.tasks.length === 0)
    throw new PipelineError(
      'E_SHIP_SCOPE_COMPLETE',
      'Every planned task is already covered as complete; use reopen for an overlapping terminal scope.',
    );
  const declaredSpecialists = [
    ...(Array.isArray(currentSpec?.frontmatter?.review_specialists)
      ? currentSpec.frontmatter.review_specialists
      : []),
    ...prepared.tasks.flatMap(({ reviewRisks = [] }) => reviewRisks),
  ];
  const declaredSurfaces = [
    ...prepared.tasks.flatMap(({ browserSurfaces = [] }) => browserSurfaces),
    ...(prepared.tasks.some(({ type }) => type === 'UI') ? ['ui'] : []),
  ];
  const riskClassification =
    planningReview === null
      ? null
      : classifyShipRisk({
          subjectDigest: planningReview.planDigest,
          changedPaths: [],
          browserSurfaces: BROWSER_SURFACES.filter((surface) => declaredSurfaces.includes(surface)),
          contractChanges: false,
          migrationChanges: false,
          permissionEffects: false,
          dataWrites: false,
          performanceBudgets: false,
          explicitRisks: SHIP_SPECIALIST_IDS.filter((id) => declaredSpecialists.includes(id)),
        });
  if (
    riskClassification !== null &&
    reviewerRoster !== undefined &&
    JSON.stringify(reviewerRoster) !== JSON.stringify(riskClassification.reviewerRoster)
  ) {
    throw new PipelineError(
      'E_SHIP_REVIEWER_DERIVATION_INVALID',
      'New Protocol 1.1 SHIP reviewer membership is classifier-owned and cannot be supplied by the caller.',
    );
  }
  return createShipClosure({
    projectRoot,
    prepared,
    runtime,
    repositories: repositories ?? configuredShipRepositories(projectRoot),
    reviewerRoster: riskClassification?.reviewerRoster ?? reviewerRoster,
    gates: gates ?? configuredShipGates(projectRoot),
    runId,
    planningReview,
    riskClassification,
  });
}

export function advanceShip({ projectRoot = process.cwd(), feature, runId, event } = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  return advanceStoredShipClosure({ prepared, runId, event });
}

export function runShipGates({
  projectRoot = process.cwd(),
  feature,
  runId,
  phase,
  expectedGeneration,
} = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  return runStoredShipGates({ prepared, runId, phase, expectedGeneration });
}

export function finalizeShipClosure({ projectRoot = process.cwd(), feature, runId } = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  return finalizeStoredShipClosure({
    projectRoot,
    prepared,
    runId,
    repositories: prepared.repositoryInputs,
  });
}

/**
 * @deprecated Use finalizeShipClosure with an exact closure runId.
 *
 * The named export remains available so existing ESM consumers fail through a
 * bounded migration error instead of failing during module linking. Supplying
 * the new closure identity delegates without recreating legacy completion
 * authority.
 */
export function finalizeShip(options = {}) {
  if (options && typeof options === 'object' && typeof options.runId === 'string') {
    return finalizeShipClosure(options);
  }
  throw new PipelineError(
    'E_SHIP_LEGACY_API_RETIRED',
    'finalizeShip no longer accepts caller-authored completion truth.',
    'Use finalizeShipClosure({ feature, runId }); the terminal closure receipt owns completion truth.',
  );
}

/**
 * @deprecated Task completion is accepted only through advanceShip and a
 * generation-bound task.completed or task.blocked event.
 */
export function recordTaskResult() {
  throw new PipelineError(
    'E_SHIP_LEGACY_API_RETIRED',
    'recordTaskResult no longer writes task or completion truth directly.',
    'Use advanceShip({ feature, runId, event }) with the current closure generation.',
  );
}

export function reopenShip({
  projectRoot = process.cwd(),
  feature,
  receiptHash,
  reason,
  ownerConfirmed = false,
  runtime = 'unknown',
  runId,
  repositories,
  gates,
} = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature, includeTasks: true });
  return reopenStoredShipClosure({
    projectRoot,
    prepared,
    receiptHash,
    reason,
    ownerConfirmed,
    runtime,
    runId,
    repositories: repositories ?? prepared.repositoryInputs,
    gates: gates ?? configuredShipGates(projectRoot),
  });
}

export function getShipClosure({ projectRoot = process.cwd(), feature, runId } = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  return readStoredShipClosure({ prepared, runId });
}

export function inspectShipClosureForLanding({
  projectRoot = process.cwd(),
  feature,
  receiptHash,
} = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature, includeTasks: true });
  return inspectStoredShipClosureForLanding({ projectRoot, prepared, receiptHash });
}

export function prepareBrowserQa({
  projectRoot = process.cwd(),
  feature,
  runId,
  runtimeHost = null,
  session = null,
  now = new Date().toISOString(),
} = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  const state = readStoredShipClosure({ prepared, runId });
  const candidate = state.candidateRevisions.at(-1);
  if (!state.riskClassification?.browserQa.required || !candidate) {
    throw new PipelineError(
      'E_BROWSER_QA_NOT_REQUIRED',
      'This SHIP run has no sealed mandatory browser-QA requirement.',
    );
  }
  const preview = {
    ok: true,
    runId,
    generation: state.generation,
    candidateRevision: candidate.revision,
    candidateDigest: candidate.digest,
    required: true,
    requirementDigest: state.riskClassification.browserQa.requirementDigest,
    triggers: structuredClone(state.riskClassification.browserQa.triggers),
  };
  if ((runtimeHost === null) !== (session === null)) {
    throw new PipelineError(
      'E_BROWSER_QA_HOST_UNTRUSTED',
      'A trusted browser runtime host and ephemeral session must be established together.',
    );
  }
  if (runtimeHost !== null) {
    assertBrowserQaSession(session, { now });
    const runtimeCapability = establishBrowserQaRuntimeCapability({
      host: runtimeHost,
      candidateDigest: candidate.digest,
      requirementDigest: state.riskClassification.browserQa.requirementDigest,
      sessionBindingDigest: sha256Jcs(session),
      sessionId: session.sessionId,
      signedIn: session.signedIn,
      issuedAt: now,
      expiresAt: session.expiresAt,
    });
    Object.defineProperty(preview, 'runtimeCapability', {
      value: runtimeCapability,
      enumerable: false,
    });
  }
  return preview;
}

export function recordBrowserQa({
  projectRoot = process.cwd(),
  feature,
  runId,
  expectedGeneration,
  result,
  session = null,
  attestation = null,
  now = new Date().toISOString(),
} = {}) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  const state = readStoredShipClosure({ prepared, runId });
  const candidate = state.candidateRevisions.at(-1);
  if (!state.riskClassification?.browserQa.required || !candidate) {
    throw new PipelineError(
      'E_BROWSER_QA_NOT_REQUIRED',
      'This SHIP run has no sealed mandatory browser-QA requirement.',
    );
  }
  const record = issueBrowserQaGateRecord({
    result,
    session,
    attestation,
    required: true,
    candidateRevision: candidate.revision,
    candidateDigest: candidate.digest,
    requirementDigest: state.riskClassification.browserQa.requirementDigest,
    now,
  });
  const issuedEvent = issueBrowserQaRecordedEvent({ expectedGeneration, record });
  return advanceStoredShipClosure({
    prepared,
    runId,
    now,
    event: issuedEvent.event,
    browserQaEventAuthority: issuedEvent.authority,
  });
}

function investigationContext({ projectRoot, feature }) {
  const prepared = prepareShipRunContext({ projectRoot, feature });
  return {
    projectRoot,
    featureRoot: prepared.root,
    repositoryRoots: Object.fromEntries(
      prepared.closureRepositories.map(({ repositoryKey, root }) => [repositoryKey, root]),
    ),
  };
}

export function prepareInvestigationFixAuthorization({
  projectRoot = process.cwd(),
  feature,
  request,
} = {}) {
  return prepareStoredInvestigationFixAuthorization({
    ...investigationContext({ projectRoot, feature }),
    request,
  });
}
export function startInvestigation({
  projectRoot = process.cwd(),
  feature,
  request,
  commandHost,
  fixCapability,
} = {}) {
  return startStoredInvestigation({
    ...investigationContext({ projectRoot, feature }),
    request,
    commandHost,
    fixCapability,
  });
}
export function advanceInvestigation({
  projectRoot = process.cwd(),
  feature,
  runId,
  event,
  commandHost,
} = {}) {
  return advanceStoredInvestigation({
    ...investigationContext({ projectRoot, feature }),
    runId,
    event,
    commandHost,
  });
}
export function verifyInvestigation({
  projectRoot = process.cwd(),
  feature,
  runId,
  commandHost,
} = {}) {
  return verifyStoredInvestigation({
    ...investigationContext({ projectRoot, feature }),
    runId,
    commandHost,
  });
}
export function finalizeInvestigation({ projectRoot = process.cwd(), feature, runId } = {}) {
  return finalizeStoredInvestigation({ ...investigationContext({ projectRoot, feature }), runId });
}

export function nextShipBatch(tasks) {
  const done = new Set(
    tasks.filter((task) => task.status === 'done').map((task) => task.selector ?? task.id),
  );
  const pending = tasks.filter((task) => !['done', 'blocked'].includes(task.status));
  const ready = pending.filter((task) =>
    (task.dependencySelectors ?? task.dependsOn).every((dependency) => done.has(dependency)),
  );
  const blocked = tasks.filter((task) => task.status === 'blocked');
  return {
    ready,
    blocked,
    complete: pending.length === 0,
    deadlocked: pending.length > 0 && ready.length === 0,
  };
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
  if (!schemaPath)
    throw new PipelineError('E_SCHEMA_UNKNOWN', `Unknown protocol artifact kind: ${kind}`);
  const schema = JSON.parse(readFileSync(join(packageRoot, schemaPath), 'utf8'));
  return validateJson(value, schema);
}

export function runSyncAudit({ projectRoot = process.cwd() } = {}) {
  const planrDir = join(projectRoot, '.planr');
  const graph = buildGraph(planrDir, { preferNative: true });
  const counts = Object.fromEntries(
    ['spec', 'story', 'task', 'quick', 'backlog'].map((type) => [
      type,
      graph.nodes.filter((node) => node.type === type).length,
    ]),
  );
  return { ok: true, readOnly: true, counts, nodes: graph.nodes.length, edges: graph.edges.length };
}
