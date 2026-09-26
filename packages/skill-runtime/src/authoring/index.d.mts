export type RepositoryAccess = 'request-scope' | 'declared-paths' | 'read-only' | 'none';
export type ExternalDataAccess = 'read-only' | 'none';
export type OutputClass = 'A' | 'B' | 'C' | 'D';

export interface AuthorityCeiling {
  readonly repositoryAccess: RepositoryAccess;
  readonly externalDataAccess: ExternalDataAccess;
  readonly allowedCapabilities: ReadonlyArray<string>;
  readonly allowedTools: ReadonlyArray<string>;
  readonly allowedOperations: ReadonlyArray<string>;
  readonly allowedOutputClasses: ReadonlyArray<OutputClass>;
  readonly forbiddenEffects: ReadonlyArray<string>;
}

export interface SourceEdge {
  from: string;
  to: string;
  field?: string;
}

export interface DiagnosticOwner {
  kind: string;
  id: string;
  version: string;
}

export interface Diagnostic {
  code: string;
  message: string;
  owner: DiagnosticOwner;
  path: string;
  pointer: string | null;
  edge: SourceEdge | null;
  repair: string | null;
  details: Record<string, unknown>;
}

export declare const AUTHORING_EXIT: { readonly ok: 0; readonly failure: 1; readonly usage: 2 };
export declare const AUTHORING_RESULT_KIND: 'skill-author-command-result';
export declare const AUTHORING_RESULT_VERSION: '1.0.0';

export type AuthoringCommand = 'lint' | 'generate' | 'check' | 'preview' | 'evaluate';
export interface AuthoringCommandContract {
  readonly command: AuthoringCommand;
  readonly description: string;
  readonly writesOutput: boolean;
  readonly npmScript: `skill:${AuthoringCommand}`;
}
export declare const AUTHORING_COMMANDS: Readonly<
  Record<AuthoringCommand, AuthoringCommandContract>
>;
export declare function getAuthoringCommand(command: string): AuthoringCommandContract;
export declare function authoringUsage(command: string): string;
export declare function parseAuthoringArgs(
  command: string,
  argv: readonly string[],
): Readonly<{
  help?: true;
  error?: string;
  json: boolean;
  skillDir?: string;
}>;

export declare class SkillAuthoringError extends Error {
  code: string;
  details: Record<string, unknown>;
  usage: boolean;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}

export declare function toDiagnostic(error: unknown): Diagnostic;
export declare function formatDiagnostic(diagnostic: Diagnostic): string;
export declare function formatDiagnostics(diagnostics: readonly Diagnostic[]): string;

export interface ModuleReference {
  moduleId: string;
  moduleVersion: string;
  digest: `sha256:${string}`;
}

export interface SelectedModule {
  moduleId: string;
  moduleVersion: string;
  mode: 'inline' | 'overlay' | 'routed';
}

export interface LoadedComposedSkill {
  skillDir: string;
  skillSource: Record<string, unknown>;
  skillSourceCustody: { readonly path: string; readonly digest: `sha256:${string}` };
  moduleRegistry: Record<string, unknown>;
  hostProfileRegistry: Record<string, unknown>;
  modules: ReadonlyArray<Record<string, unknown>>;
  hostProfilesByKey: Map<string, Record<string, unknown>>;
  declaredProfiles: ReadonlyArray<Record<string, unknown>>;
  cursorTemplate: string;
  readSource: (relativePath: string) => string;
}

export declare function loadComposedSkill(options: { skillDir: string }): LoadedComposedSkill;

export interface AuthoringGraph {
  skillId: string;
  skillVersion: string;
  sourceFormat: string;
  sources: {
    readonly skill: 'skill.json';
    readonly modules: 'modules.json';
    readonly hostProfiles: 'host-profiles.json';
    readonly template: string;
  };
  modules: ReadonlyArray<{
    moduleId: string;
    moduleVersion: string;
    moduleKind: string;
    source: string;
    appliesWhen: string;
    authority: AuthorityCeiling;
    dependsOn: ReadonlyArray<{ moduleId: string; moduleVersion: string }>;
    references: ReadonlyArray<{ moduleId: string; moduleVersion: string }>;
  }>;
  hostProfiles: ReadonlyArray<{
    id: string;
    version: string;
    host: string;
    source: string;
    authority: AuthorityCeiling;
    overlayModules: ReadonlyArray<{ moduleId: string; moduleVersion: string }>;
    runtimeCapabilities: ReadonlyArray<string>;
    interactionBindings: ReadonlyArray<{
      surface: 'native' | 'chat' | 'terminal' | 'headless';
      protocolInteraction: 'native' | 'chat' | 'terminal' | 'none';
      capabilityId?: string;
    }>;
  }>;
}

export declare function describeAuthoringGraph(loaded: LoadedComposedSkill): AuthoringGraph;

interface FailureResult {
  kind: 'skill-author-command-result';
  contractVersion: '1.0.0';
  status: 'failed';
  ok: false;
  command: AuthoringCommand;
  exit: 1 | 2;
  diagnostics: Diagnostic[];
}

type SuccessResult<T> = {
  kind: 'skill-author-command-result';
  contractVersion: '1.0.0';
  status: 'completed';
  ok: true;
  command: AuthoringCommand;
  exit: 0;
  diagnostics: [];
} & T;
export type OperationResult<T> = SuccessResult<T> | FailureResult;

export interface LintReport {
  skillId: string;
  skillVersion: string;
  sourceFormat: string;
  graph: AuthoringGraph;
  modules: SelectedModule[];
  hostProfiles: Array<{ id: string; version: string; host: string }>;
  content: SkillContentReport[];
}

export interface SkillContentReport {
  skillId: string;
  host: string;
  entrypoint: string;
  assets: string[];
  links: Array<{ from: string; to: string; line: number }>;
  linkedSupport: string[];
}

export interface PreviewHost {
  host: string;
  hostProfile: string;
  inline: Array<{ moduleId: string; moduleVersion: string; source: string }>;
  overlayModules: Array<{ moduleId: string; moduleVersion: string; source: string }>;
  routed: Array<{ moduleId: string; moduleVersion: string; path: string }>;
  overlay: { hostProfile: string; authority: AuthorityCeiling };
  capabilityDecision: null | {
    status: 'declared';
    preferred: {
      surface: 'native' | 'chat' | 'terminal' | 'headless';
      capabilityId: string | null;
    };
    fallbacks: Array<{
      surface: 'native' | 'chat' | 'terminal' | 'headless';
      capabilityId: string | null;
    }>;
    declaredCapabilities: string[];
    repair: null;
  };
  owners: Array<{
    ownerKind: 'template' | 'source' | 'host-profile' | 'compiler';
    pointer: string;
    version: string;
  }>;
  outputs: Array<{ kind: 'primary' | 'reference'; path: string; byteLength: number }>;
  repairs: string[];
}

export interface PreviewReport {
  skillId: string;
  skillVersion: string;
  graph: AuthoringGraph;
  hosts: PreviewHost[];
  content: SkillContentReport[];
}

export interface CheckReport {
  skillId: string;
  graph: AuthoringGraph;
  output: {
    state: 'not-generated' | 'current';
    checked: boolean;
    outputDir: 'dist';
  };
  content: SkillContentReport[];
  assets: Array<{ host: string; path: string; digest: `sha256:${string}`; byteLength: number }>;
}

export interface GenerateReport {
  skillId: string;
  skillVersion: string;
  graph: AuthoringGraph;
  outputDir: 'dist';
  assetSetId: string;
  assets: Array<{
    host: string;
    path: string;
    outputPath: string;
    digest: `sha256:${string}`;
    byteLength: number;
  }>;
  content: SkillContentReport[];
  manifests: ['manifests/generated-assets.json', 'manifests/generated-custody.json'];
}

export interface EvaluateHost {
  host: string;
  hostProfile: string;
  pass: boolean;
  digest: `sha256:${string}`;
  byteLength: number;
  inlineModules: number;
  routedReferences: number;
  checks: { idempotent: boolean; sourceMapComplete: boolean; manifestValid: boolean };
  reasons: string[];
}

export interface EvaluateReport {
  skillId: string;
  graph: AuthoringGraph;
  hosts: EvaluateHost[];
  content: SkillContentReport[];
}

export declare function lintSkill(options: { skillDir: string }): OperationResult<LintReport>;
export declare function previewSkill(options: { skillDir: string }): OperationResult<PreviewReport>;
export declare function generateSkill(options: {
  skillDir: string;
}): OperationResult<GenerateReport>;
export declare function checkSkill(options: { skillDir: string }): OperationResult<CheckReport>;
export declare function evaluateSkill(options: {
  skillDir: string;
}): OperationResult<EvaluateReport>;

export interface StandardSkillReport {
  skillId: string;
  skillVersion: string;
  sourceFormat: 'package-v1';
  description: string;
  entrypoint: 'SKILL.md';
  entrypointDigest: `sha256:${string}`;
  entrypointBytes: number;
  execution: 'host-agent' | 'deterministic-utility';
  hosts: string[];
  resources: Array<Record<string, unknown>>;
  legacyFiles: string[];
  outputs: Array<{ host: string; root: string; entrypoint: string }>;
}

export declare function isStandardSkillPackage(skillDir: string): boolean;
export declare function inspectStandardSkill(options: {
  skillDir: string;
  command: Exclude<AuthoringCommand, 'generate'>;
}): OperationResult<StandardSkillReport>;
