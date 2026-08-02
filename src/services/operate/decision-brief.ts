import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OperatingArtifactGenerationPlan } from './artifact-route-generation.js';
import { resolveOperatingPipelineRoot } from './protocol.js';
import { compareSensitivity, sanitizeGeneratedPlainText } from './redaction.js';
import { OperateError, type OperatingSensitivity } from './types.js';
import { resolveContainedPath, resolveOperatingPaths } from './workspace.js';

/**
 * FR7 / E-007 — render `operate brief` and `operate decisions show` into a
 * single, self-contained, OFFLINE artifact a non-technical decision owner can
 * open without a terminal. Rendering is delegated to the pipeline builder
 * (`createOperatingDecisionBriefArtifact`), which fails closed on any
 * `http(s)://` reference (`E_OPERATE_DECISION_BRIEF_NOT_OFFLINE`). This module
 * never reimplements that renderer: it assembles the ceiling-filtered brief and
 * decision inputs, invokes the builder through the existing opaque-origin
 * sandbox surface, and writes the resulting HTML locally.
 *
 * Nothing here publishes or shares: a brief is written only when the operator
 * asks for it (the `--render` flag), to a project-contained path. Sensitivity
 * ceilings that gate collection (T-002) and dispatch (T-003) also gate rendered
 * content here — evidence above the configured ceiling is dropped before the
 * builder ever sees it, and free-text fields pass through the redaction path.
 */

/**
 * The opaque-origin sandbox contract reused from `artifact-route-generation.ts`
 * (`network: 'none', filesystem: 'none', tools: []`), the same posture proven
 * out for generated route artifacts. A decision brief is a fully-offline
 * reading document, so it additionally allows NO external URL scheme — the
 * pipeline builder rejects any `http(s)://` reference outright. The shape is
 * kept structurally compatible with the route sandbox so no new sandbox model
 * is invented (DoD point 5).
 */
export const OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX: {
  readonly network: OperatingArtifactGenerationPlan['sandbox']['network'];
  readonly filesystem: OperatingArtifactGenerationPlan['sandbox']['filesystem'];
  readonly tools: readonly [];
  readonly allowedUrlSchemes: readonly [];
} = Object.freeze({
  network: 'none',
  filesystem: 'none',
  tools: Object.freeze([]) as readonly [],
  allowedUrlSchemes: Object.freeze([]) as readonly [],
});

export interface DecisionBriefEvidence {
  ref: string;
  sensitivity: OperatingSensitivity;
}

export interface DecisionBriefOption {
  label: string;
  detail?: string;
}

export interface DecisionBriefDecisionFacts {
  status?: string;
  owner?: string;
  selectedOption?: string;
  recommendation?: string;
  reversibility?: string;
  deadline?: string;
  note?: string;
}

/**
 * Structured, render-ready brief/decision data assembled by `reports.ts`. It
 * carries evidence as `{ ref, sensitivity }` (never resolved content) so the
 * ceiling filter can drop above-ceiling citations without any sensitive text
 * ever reaching the renderer.
 */
export interface DecisionBriefSource {
  kind: 'brief' | 'decision';
  id: string;
  cycleId: string;
  title: string;
  summary?: string;
  question?: string;
  evidence: DecisionBriefEvidence[];
  options?: DecisionBriefOption[];
  blocks?: string;
  decision?: DecisionBriefDecisionFacts | null;
}

interface OperatingDecisionBriefArtifactEnvelope {
  schemaVersion: string;
  artifacts: Array<{
    id: string;
    kind: string;
    title: string;
    sha256: `sha256:${string}`;
    html: string;
    viewport: { width: number; height: number };
    colorScheme: string;
  }>;
  viewer: Record<string, unknown>;
}

type OperatingDecisionBriefBuilder = (
  brief: Record<string, unknown>,
  decision?: Record<string, unknown> | null,
) => OperatingDecisionBriefArtifactEnvelope;

export interface RenderedOperatingDecisionBrief {
  envelope: OperatingDecisionBriefArtifactEnvelope;
  html: string;
  sha256: `sha256:${string}`;
  sandbox: typeof OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX;
  redactedEvidenceRefs: string[];
  offline: true;
}

export interface WrittenOperatingDecisionBrief extends RenderedOperatingDecisionBrief {
  path: string;
  sensitivityCeiling: OperatingSensitivity;
}

/**
 * Load the pipeline's decision-brief builder from the installed pipeline root.
 * The absolute-file import mirrors `pipeline-handoff.ts` (the package `exports`
 * map does not expose the raw subpath). Fails closed when the pipeline is not
 * installed so a brief can never silently degrade to an in-repo reimplementation.
 */
async function loadOperatingDecisionBriefBuilder(): Promise<OperatingDecisionBriefBuilder> {
  const root = resolveOperatingPipelineRoot();
  if (!root) {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'Rendering a self-contained operating decision brief requires the full planr-pipeline package.',
      {
        recovery:
          'Run `npm install -g openplanr@latest` (without `--omit=optional`), then `planr setup --scope user`.',
      },
    );
  }
  const module = (await import(
    pathToFileURL(path.join(root, 'lib', 'pipeline', 'index.mjs')).href
  )) as { createOperatingDecisionBriefArtifact?: OperatingDecisionBriefBuilder };
  if (typeof module.createOperatingDecisionBriefArtifact !== 'function') {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'The installed pipeline does not expose the self-contained decision-brief renderer.',
    );
  }
  return module.createOperatingDecisionBriefArtifact;
}

/**
 * Drop every evidence citation whose sensitivity exceeds the configured
 * ceiling. Pure and deterministic: the kept citations preserve input order and
 * the redacted refs are returned de-duplicated and sorted for a stable record.
 */
export function filterEvidenceByCeiling(
  evidence: readonly DecisionBriefEvidence[],
  ceiling: OperatingSensitivity,
): { kept: DecisionBriefEvidence[]; redactedRefs: string[] } {
  const kept: DecisionBriefEvidence[] = [];
  const redactedRefs: string[] = [];
  for (const item of evidence) {
    if (compareSensitivity(item.sensitivity, ceiling) > 0) redactedRefs.push(item.ref);
    else kept.push(item);
  }
  return { kept, redactedRefs: [...new Set(redactedRefs)].sort() };
}

function redactedText(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const sanitized = sanitizeGeneratedPlainText(value).trim();
  return sanitized === '' ? undefined : sanitized;
}

function redactedFacts(
  decision: DecisionBriefDecisionFacts | null | undefined,
): Record<string, string> | null {
  if (!decision) return null;
  const facts: Record<string, string> = {};
  for (const key of [
    'status',
    'owner',
    'selectedOption',
    'recommendation',
    'reversibility',
    'deadline',
    'note',
  ] as const) {
    const value = redactedText(decision[key]);
    if (value !== undefined) facts[key] = value;
  }
  return Object.keys(facts).length > 0 ? facts : null;
}

/**
 * Assemble the ceiling-filtered, redacted brief/decision inputs for the
 * pipeline builder. Evidence above the ceiling is removed here — before the
 * renderer runs — and every free-text field passes through the redaction path,
 * so above-ceiling and secret-like content can never reach rendered output.
 */
export function buildDecisionBriefInput(
  source: DecisionBriefSource,
  ceiling: OperatingSensitivity,
): {
  brief: Record<string, unknown>;
  decision: Record<string, string> | null;
  redactedEvidenceRefs: string[];
} {
  const { kept, redactedRefs } = filterEvidenceByCeiling(source.evidence, ceiling);
  const evidence = kept.map((item) => item.ref);
  const options = (source.options ?? [])
    .map((option) => {
      const label = redactedText(option.label);
      if (label === undefined) return null;
      const detail = redactedText(option.detail);
      return detail === undefined ? { label } : { label, detail };
    })
    .filter((option): option is DecisionBriefOption => option !== null);

  const brief: Record<string, unknown> = {
    id: source.id,
    title: source.title.trim(),
  };
  const summary = redactedText(source.summary);
  if (summary !== undefined) brief.summary = summary;
  const question = redactedText(source.question);
  if (question !== undefined) brief.question = question;
  if (evidence.length > 0) brief.evidence = evidence;
  if (options.length > 0) brief.options = options;
  const blocks = redactedText(source.blocks);
  if (blocks !== undefined) brief.blocks = blocks;

  return {
    brief,
    decision: redactedFacts(source.decision),
    redactedEvidenceRefs: redactedRefs,
  };
}

/**
 * Render a ceiling-filtered brief/decision into a validated, self-contained
 * offline artifact envelope. The pipeline builder is authoritative for the
 * offline posture: any `http(s)://` reference in the rendered HTML fails closed
 * with `E_OPERATE_DECISION_BRIEF_NOT_OFFLINE`, which is allowed to propagate
 * unchanged (DoD: an external reference "fails closed via the pipeline error").
 */
export async function renderOperatingDecisionBriefArtifact(
  source: DecisionBriefSource,
  ceiling: OperatingSensitivity,
): Promise<RenderedOperatingDecisionBrief> {
  const build = await loadOperatingDecisionBriefBuilder();
  const { brief, decision, redactedEvidenceRefs } = buildDecisionBriefInput(source, ceiling);
  const envelope = build(brief, decision);
  const artifact = envelope.artifacts[0];
  if (artifact?.kind !== 'html' || typeof artifact.html !== 'string') {
    throw new OperateError(
      'E_OPERATE_ARTIFACT_REJECTED',
      'The decision-brief renderer did not return a single HTML artifact.',
    );
  }
  return {
    envelope,
    html: artifact.html,
    sha256: artifact.sha256,
    sandbox: OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX,
    redactedEvidenceRefs,
    offline: true,
  };
}

/**
 * Read the machine-local sensitivity ceiling. Mirrors the collection/dispatch
 * paths: the ceiling defaults to `internal` when preferences are absent so a
 * brief is never rendered with a more permissive posture than collection used.
 */
export async function readOperatingSensitivityCeiling(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingSensitivity> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot: options.localRoot });
  const preferences = await readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as { sensitivityCeiling?: OperatingSensitivity })
    .catch(() => ({ sensitivityCeiling: 'internal' as const }));
  return preferences.sensitivityCeiling ?? 'internal';
}

/**
 * Render a brief/decision and write its self-contained HTML to a
 * project-contained destination. This is the share-on-request boundary:
 * nothing is written unless the operator supplied `--render <path>`, and the
 * file is written with restrictive permissions to the local project only. When
 * `ceiling` is omitted it is resolved from the machine-local preferences.
 */
export async function writeOperatingDecisionBriefArtifact(input: {
  projectRoot: string;
  destination: string;
  source: DecisionBriefSource;
  ceiling?: OperatingSensitivity;
  localRoot?: string;
}): Promise<WrittenOperatingDecisionBrief> {
  const ceiling =
    input.ceiling ??
    (await readOperatingSensitivityCeiling(input.projectRoot, { localRoot: input.localRoot }));
  const target = await resolveContainedPath(input.projectRoot, input.destination);
  const rendered = await renderOperatingDecisionBriefArtifact(input.source, ceiling);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, rendered.html, { mode: 0o600 });
  await rename(temporary, target);
  return { ...rendered, path: target, sensitivityCeiling: ceiling };
}
