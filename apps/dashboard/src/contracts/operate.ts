/** Browser-local structural boundary for the Node-owned Operate client. */
export type OperateActorV2 = Readonly<{
  actorId: string;
  kind: 'agent' | 'human';
  runtime: string;
}>;

export interface OperateActionReader {
  readActionWorkspace(actionId: string, cycleId: string, actor: OperateActorV2): Promise<unknown>;
}

export interface OperateCycleReader {
  readCycleWorkspace(cycleId: string, actor: OperateActorV2): Promise<unknown>;
  readExecutiveBoardDisplay(cycleId: string, actor: OperateActorV2): Promise<unknown>;
}

export interface OperateExperienceCycleStageV1 {
  id: 'observe' | 'understand' | 'decide' | 'govern' | 'act' | 'verify' | 'learn';
  state:
    | 'complete'
    | 'current'
    | 'available'
    | 'blocked'
    | 'skipped'
    | 'failed'
    | 'uncertain'
    | 'revisited'
    | 'waiting';
  reason: string | null;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  gates: Array<{
    kind: 'review' | 'approval' | 'execution' | 'verification' | 'learning';
    subjectId: string;
    state: string;
  }>;
  evidenceGapIds: string[];
  uncertaintyIds: string[];
  persistentActionIds: string[];
}
