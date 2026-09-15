export declare const ARTIFACT_ERROR_CODES: Readonly<Record<string, string>>;
export declare const PIPELINE_ERROR_CODES: Readonly<Record<string, string>>;
export declare const PROTOCOL_ERROR_CODES: Readonly<Record<string, string>>;
export declare class PipelineError extends Error {
  readonly code: string;
  readonly fix: string;
  readonly details?: unknown;
  constructor(code: string, message: string, fix?: string, details?: unknown);
  toJSON(): { ok: false; code: string; problem: string; fix?: string; details?: unknown };
}
export declare class ProtocolError extends PipelineError {}
