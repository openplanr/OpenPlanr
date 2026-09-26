export type EvaluationDigest = `sha256:${string}`;
export type EvaluationJourneyKind =
  | 'positive'
  | 'negative'
  | 'ambiguity'
  | 'permission-denied'
  | 'recovery'
  | 'packed-install';
export type EvaluationScenarioStatus = 'passed' | 'failed' | 'blocked' | 'absent' | 'waived';
export type EvaluationVerdict = 'PASS' | 'BLOCKED';

export interface EvaluationBrowserAdapter {
  adapterId: string;
  trusted: boolean;
  attests: readonly string[];
  probe(
    session: { origin: string; requests: unknown[] },
    surface: unknown,
  ): Promise<{
    evidence: unknown[];
    unattested: readonly string[];
  }>;
}

export interface EvaluationInputs {
  catalog: unknown;
  manifest: unknown;
  hostProfileRegistry: unknown;
  graderRegistry: unknown;
  baseline: unknown;
  budget: unknown;
  gatePolicy: unknown;
  corpora: readonly unknown[];
  /** Frozen-catalog skills with no corpus on disk. A partial catalog is reported, never inferred. */
  uncoveredSkills: readonly string[];
  packageJson: unknown;
  packageDigest: EvaluationDigest;
  sourceDigest: EvaluationDigest;
}

export interface EvaluationGateEntry {
  metric: string;
  waivable: boolean;
  status: 'met' | 'not-met' | 'waived';
  waiverDigest: EvaluationDigest | null;
}

export interface EvaluationGateOutcome {
  gateEvaluation: readonly EvaluationGateEntry[];
  appliedWaivers: readonly Record<string, string>[];
  refusedWaivers: readonly { waiverDigest: EvaluationDigest; metric: string; code: string }[];
  blockingMetrics: readonly string[];
  result: 'release-ready' | 'blocked';
}

export interface EvaluationScenarioEvidence {
  scenarioId: `esc_${string}`;
  inputs: Record<string, EvaluationDigest>;
}

export interface EvaluationOutcome {
  runId: `eru_${string}`;
  runResult: unknown;
  aggregateReport: unknown;
  receipts: readonly unknown[];
  gates: EvaluationGateOutcome;
  findings: readonly { kind: string; scenarioDigest: EvaluationDigest | null }[];
  evidenceInputs: readonly EvaluationScenarioEvidence[];
  reuse: {
    reusable: readonly string[];
    invalidated: readonly {
      scenarioId: string;
      reason: string;
      changedInputs: readonly string[];
    }[];
    unevaluated: readonly string[];
  } | null;
  uncoveredSkills: readonly string[];
  catalogSkills: readonly string[];
  manifestDigest: EvaluationDigest;
  verdict: EvaluationVerdict;
}

export interface EvaluationRunOptions {
  repoRoot: string;
  /** Explicit canonical source root; required even when preloaded inputs are supplied. */
  sourceRoot: string;
  now: string;
  clock?: () => string;
  waivers?: readonly unknown[];
  owners?: readonly string[];
  /** Null keeps browser journeys blocking instead of inferring a pass. */
  browserAdapter?: EvaluationBrowserAdapter | null;
  priorEvidence?: readonly EvaluationScenarioEvidence[] | null;
  inputs?: EvaluationInputs;
}

export const EVALUATION_CORPUS_ROOT: string;
export const EVALUATION_HOST_PROFILE_ROOT: string;
export const EVALUATION_BUDGET_PATH: string;
export const EVALUATION_BASELINE_PATH: string;
export const EVALUATION_GATE_POLICY_PATH: string;
export const EVALUATION_LOOPBACK_SURFACE_PATH: string;

/** Without sourceRoot the default view is legacy; a sourceRoot selects active unless view is legacy. */
export type EvaluationInputOptions = { repoRoot: string } & (
  | { sourceRoot: string; view?: 'active' | 'legacy' }
  | { sourceRoot?: undefined; view?: 'legacy' }
);

export function loadEvaluationInputs(options: EvaluationInputOptions): EvaluationInputs;
export function runEvaluation(options: EvaluationRunOptions): Promise<EvaluationOutcome>;
