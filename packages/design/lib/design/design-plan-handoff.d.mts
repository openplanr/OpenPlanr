import type { DesignImplementationHandoff } from '@openplanr/protocol/design-handoff-contracts';

export interface DesignPlanHandoff {
  kind: 'openplanr-design-plan-handoff';
  schemaVersion: '1.0.0';
  authority: 'prepare-plan';
  handoff: { id: string; version: number; contentDigest: string };
  subject: string;
  invocations: { claudeCode: string; codex: string; chatgpt: string; cursor: string; fallback: string };
  effects: { planningFilesWritten: false; agentDispatched: false; shipStarted: false; gitChanged: false };
}
export declare function prepareDesignPlanHandoff(handoff: DesignImplementationHandoff, options?: { subject?: string }): Readonly<DesignPlanHandoff>;
