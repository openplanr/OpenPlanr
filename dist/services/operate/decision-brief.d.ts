import type { OperatingArtifactGenerationPlan } from './artifact-route-generation.js';
import { type OperatingSensitivity } from './types.js';
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
export declare const OPAQUE_ORIGIN_DECISION_BRIEF_SANDBOX: {
    readonly network: OperatingArtifactGenerationPlan['sandbox']['network'];
    readonly filesystem: OperatingArtifactGenerationPlan['sandbox']['filesystem'];
    readonly tools: readonly [];
    readonly allowedUrlSchemes: readonly [];
};
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
        viewport: {
            width: number;
            height: number;
        };
        colorScheme: string;
    }>;
    viewer: Record<string, unknown>;
}
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
 * Drop every evidence citation whose sensitivity exceeds the configured
 * ceiling. Pure and deterministic: the kept citations preserve input order and
 * the redacted refs are returned de-duplicated and sorted for a stable record.
 */
export declare function filterEvidenceByCeiling(evidence: readonly DecisionBriefEvidence[], ceiling: OperatingSensitivity): {
    kept: DecisionBriefEvidence[];
    redactedRefs: string[];
};
/**
 * Assemble the ceiling-filtered, redacted brief/decision inputs for the
 * pipeline builder. Evidence above the ceiling is removed here — before the
 * renderer runs — and every free-text field passes through the redaction path,
 * so above-ceiling and secret-like content can never reach rendered output.
 */
export declare function buildDecisionBriefInput(source: DecisionBriefSource, ceiling: OperatingSensitivity): {
    brief: Record<string, unknown>;
    decision: Record<string, string> | null;
    redactedEvidenceRefs: string[];
};
/**
 * Render a ceiling-filtered brief/decision into a validated, self-contained
 * offline artifact envelope. The pipeline builder is authoritative for the
 * offline posture: any `http(s)://` reference in the rendered HTML fails closed
 * with `E_OPERATE_DECISION_BRIEF_NOT_OFFLINE`, which is allowed to propagate
 * unchanged (DoD: an external reference "fails closed via the pipeline error").
 */
export declare function renderOperatingDecisionBriefArtifact(source: DecisionBriefSource, ceiling: OperatingSensitivity): Promise<RenderedOperatingDecisionBrief>;
/**
 * Read the machine-local sensitivity ceiling. Mirrors the collection/dispatch
 * paths: the ceiling defaults to `internal` when preferences are absent so a
 * brief is never rendered with a more permissive posture than collection used.
 */
export declare function readOperatingSensitivityCeiling(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<OperatingSensitivity>;
/**
 * Render a brief/decision and write its self-contained HTML to a
 * project-contained destination. This is the share-on-request boundary:
 * nothing is written unless the operator supplied `--render <path>`, and the
 * file is written with restrictive permissions to the local project only. When
 * `ceiling` is omitted it is resolved from the machine-local preferences.
 */
export declare function writeOperatingDecisionBriefArtifact(input: {
    projectRoot: string;
    destination: string;
    source: DecisionBriefSource;
    ceiling?: OperatingSensitivity;
    localRoot?: string;
}): Promise<WrittenOperatingDecisionBrief>;
export {};
//# sourceMappingURL=decision-brief.d.ts.map