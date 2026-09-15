import type { ContextEnvelopeV1 } from './context-envelope.d.mts';
export interface ShipContextOptions {
  projectRoot: string;
  feature: string;
  taskId?: string;
  runtime?: 'claude' | 'claude-code' | 'codex' | 'cursor' | string;
  readFile?: (path: string, encoding: string) => string;
}
export declare function buildShipContext(options: ShipContextOptions): Readonly<ContextEnvelopeV1>;
export declare function renderShipContext(options: ShipContextOptions): string;
export declare function buildPlanContext(
  options: Omit<ShipContextOptions, 'taskId'>,
): Readonly<ContextEnvelopeV1>;
export declare function renderPlanContext(options: Omit<ShipContextOptions, 'taskId'>): string;
