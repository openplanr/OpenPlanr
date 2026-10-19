export type AttentionNode = Readonly<{
  id: string;
  type: string;
  title: string;
  status: 'outstanding' | 'in-progress' | 'blocked' | 'addressed' | 'done';
  frontmatter: Readonly<Record<string, unknown>>;
}>;

export type AttentionGraph = Readonly<{
  nodes: readonly AttentionNode[];
  edges: readonly Readonly<{ from: string; to: string; kind: 'contains' | 'depends_on' }>[];
}>;

export type AttentionOptions = Readonly<{
  quietDays?: number;
  sprintLengthDays?: number;
}>;

export type AttentionItem = Readonly<{
  id: string;
  status: AttentionNode['status'] | 'unknown';
  readiness: 'ready' | 'blocked' | 'unknown' | 'not-applicable';
  dependencyIds: readonly string[];
  openDependencyIds: readonly string[];
  unresolvedDependencies: readonly Readonly<{
    reference: string;
    reason: 'missing' | 'ambiguous' | 'invalid';
    candidates: readonly string[];
  }>[];
  downstreamUnblockCount: number;
}>;

export type AttentionProjection = Readonly<{
  statusTotals: Readonly<{
    total: number;
    outstanding: number;
    inProgress: number;
    addressed: number;
    done: number;
    unknown: number;
    blocked: number;
  }>;
  byId: Readonly<Record<string, AttentionItem>>;
  waiting: readonly AttentionItem[];
  stale: readonly Readonly<{ id: string; authoredAt: string; ageDays: number }>[];
  unknownStaleIds: readonly string[];
  quietDays: number;
  highPriorityNotStarted: readonly string[];
  changedToday: Readonly<{
    date: string;
    ids: readonly string[];
    groups: readonly Readonly<{ specId: string | null; ids: readonly string[] }>[];
  }>;
  perSpec: readonly Readonly<{
    id: string;
    done: number;
    total: number;
    taskIds: readonly string[];
  }>[];
  dependencyCycleIds: readonly string[];
  containmentCycleIds: readonly string[];
}>;

export function deriveAttention(
  graph: AttentionGraph,
  nowUTC: string,
  options?: AttentionOptions,
): AttentionProjection;
