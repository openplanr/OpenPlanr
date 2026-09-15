export interface SkillMatchCandidate {
  readonly skillId: string;
  readonly family: string;
  readonly score: number;
  readonly include: number;
  readonly exclusion: number;
  readonly explicit: boolean;
  readonly deferTo: readonly string[];
}

export interface SkillMatchResult {
  readonly status: 'matched' | 'deferred';
  readonly skillId: string | null;
  readonly family: string | null;
  readonly reason: 'explicit-name' | 'trigger-policy' | 'declared-defer' | 'ambiguous-match' | 'no-confident-match';
  readonly candidates: readonly SkillMatchCandidate[];
}

export declare function tokenizeRoutingText(value: unknown): string[];
export declare const ROUTING_CASE_KINDS: readonly ['positive', 'paraphrase', 'near-miss', 'ambiguous', 'explicit', 'unrelated', 'optional-context'];
export declare function buildRegistryRoutingCases(registry: Record<string, unknown>): ReadonlyArray<Readonly<Record<string, unknown>>>;
export declare function buildSkillMatchIndex(registry: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function matchSkillRequest(options: {
  registry?: Record<string, unknown>;
  index?: Record<string, unknown>;
  input: string;
  threshold?: number;
  ambiguityDelta?: number;
}): SkillMatchResult;
export declare function evaluateRoutingCorpus(options: {
  registry: Record<string, unknown>;
  cases: readonly Record<string, unknown>[];
  threshold?: number;
}): Readonly<Record<string, unknown>>;
export declare function runResilienceJourney(options: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function evaluateResilienceJourneys(options: Record<string, unknown>): Readonly<Record<string, unknown>>;
