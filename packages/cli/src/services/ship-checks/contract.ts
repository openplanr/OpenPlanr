export const SHIP_CHECKS_KIND = 'openplanr-ship-checks';
export const SHIP_CHECKS_SCHEMA_VERSION = '1.0.0';

export const SHIP_TIERS = ['task', 'story', 'push', 'planning'] as const;
export type ShipTier = (typeof SHIP_TIERS)[number];

export type CheckSourceKind = 'ci' | 'hook' | 'task' | 'package' | 'planning';

export type CheckSource = {
  kind: CheckSourceKind;
  file: string | null;
  line: number | null;
  job?: string;
  step?: string;
  hook?: string;
};

export type CheckScope = 'worktree' | 'tracked-only';

export type PackageScript = { name: string; workspace: string | null };

export type ShipCheck = {
  id: string;
  command: string;
  cwd: string;
  sources: CheckSource[];
  tags: string[];
  scope: CheckScope;
  scopeReason?: string;
  script?: PackageScript;
  condition?: string;
  shell?: string;
  acceptanceIds: string[];
};

export type ShipRequirement = { kind: 'prose'; text: string; acceptanceIds: string[] };

export type RelatedTest = { name: string; kind: 'export' | 'command' | 'route'; files: string[] };

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type ShipDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path: string | null;
};

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export type ChangedFile = { path: string; status: ChangedFileStatus };

export type ShipChecksResult = {
  kind: typeof SHIP_CHECKS_KIND;
  schemaVersion: typeof SHIP_CHECKS_SCHEMA_VERSION;
  complete: boolean;
  projectRoot: string;
  tier: ShipTier;
  tierSource: 'flag' | 'auto';
  base: { ref: string; commit: string } | null;
  task: { path: string } | null;
  changed: { planningOnly: boolean; files: ChangedFile[] };
  checks: ShipCheck[];
  requirements: ShipRequirement[];
  acceptance: string[];
  relatedTests: RelatedTest[];
  diagnostics: ShipDiagnostic[];
};

/** A discovered check before its scope is classified. */
export type CheckCandidate = Omit<ShipCheck, 'scope' | 'scopeReason'>;

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  path: string | null = null,
): ShipDiagnostic {
  return { code, severity, message, path };
}
