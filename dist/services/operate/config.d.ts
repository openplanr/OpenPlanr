import { type OperatingWorkspaceVersioning } from './integrity.js';
import { type JournalWrite } from './journal.js';
import { type OperatingCharter, type OperatingConfig, type OperatingEventHead, type OperatingInitAnswers, type OperatingLocalPreferences, type OperatingProfile, type OperatingWorkspaceManifest } from './types.js';
/** Protocol v1.2 requires these persisted fields; mandate execution no longer tunes them. */
export declare const FROZEN_OPERATING_PROVIDERS: readonly ["repository", "planr", "git"];
export declare const FROZEN_OPERATING_BUDGETS: Readonly<OperatingConfig['budgets']>;
export declare const OPERATING_PROFILES: readonly OperatingProfile[];
export declare function listOperatingProfiles(): OperatingProfile[];
export declare function getOperatingProfile(id: OperatingProfile['id']): OperatingProfile;
/**
 * Strictly allowlists custom-profile data before it can be echoed, persisted,
 * or merged. This is shared by init and profiles validate so unknown fields
 * (including accidental secrets) never reach command results.
 */
export declare function normalizeCustomOperatingProfile(value: unknown): Partial<OperatingProfile>;
/**
 * Read the persisted per-project cadence `lastRunAt` marker (FR8 / E-008), or
 * `null` when no cycle has completed yet.
 */
export declare function readOperatingLastRunAt(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<string | null>;
/**
 * Persist the per-project cadence `lastRunAt` marker into the machine-local
 * preferences atomically (temp + rename, mode 0o600). FR8 / E-008: recorded whenever a cycle reaches
 * reviewable/blocked/closed so `operate status` can surface the pipeline's
 * `nextDueAt` under an injected clock. `lastRunAt` is the injected cycle instant,
 * never a wall-clock read here. Requires an initialized project.
 */
export declare function recordOperatingLastRunAt(input: {
    projectRoot: string;
    localRoot?: string;
    lastRunAt: string;
}): Promise<{
    lastRunAt: string;
    changed: boolean;
}>;
/**
 * FR10 / T-008 default adapter session lease: 15 minutes. A prepared native
 * adapter session expires this long after `prepare`, and each successful `record`
 * refreshes the window forward from the moment the record lands. This was a
 * hardcoded constant in `maintenance.ts`; it is now the machine-local default,
 * overridable per project via `preferences.json`.
 */
export declare const DEFAULT_ADAPTER_LEASE_DURATION_MS: number;
/**
 * Strictly validate an optional adapter-lease duration (milliseconds) before it is
 * echoed, persisted, or honored by the adapter lifecycle — mirroring the strict
 * operating-preference allowlisting pattern. The value must be
 * an integer within [1 minute, 60 minutes]. A non-integer or out-of-range value
 * fails closed with `E_OPERATE_CONFIG_INVALID` rather than silently clamping, so a
 * corrupt preference never quietly weakens or extends the lease.
 */
export declare function normalizeOperatingAdapterLeaseDurationMs(value: unknown): number;
/**
 * Read the machine-local adapter-lease duration (milliseconds), or the 15-minute
 * default when unset. Machine-local, alongside `evidenceTtlMs`; a present value is
 * rejected rather than trusted.
 */
export declare function readOperatingAdapterLeaseDurationMs(projectRoot: string, options?: {
    localRoot?: string;
}): Promise<number>;
export declare function normalizeCharter(input?: Partial<OperatingCharter>): OperatingCharter;
/** Normalize already-validated questionnaire or explicit CLI answers once. */
export declare function normalizeOperatingInitializationAnswers(input: OperatingInitAnswers): OperatingInitAnswers;
export declare function renderOperatingCharter(config: OperatingConfig, input?: Partial<OperatingCharter>): string;
export interface OperatingInitializationPreview {
    config: OperatingConfig;
    preferences: OperatingLocalPreferences;
    charter: string;
    workspace: OperatingWorkspaceManifest;
    previewDigest: `sha256:${string}`;
    changedPaths: string[];
    preferencesChanged: boolean;
    /**
     * FR5 / T-005: the top-level `preferences.json` keys that differ between the
     * existing file and the record about to be written — what the init preview names
     * so an operator sees exactly which machine-local preferences will change before
     * confirming. Purely informational: it never feeds `previewDigest`, so the
     * unchanged-case confirmation binding stays byte-identical.
     */
    changedPreferenceKeys: string[];
    /**
     * FR9 / T-005: whether this project's `.planr/` is gitignored, with the plain
     * statement of what that means for versioning the board. Surfaced at init so
     * the operator is told honestly whether the sanitized board will actually be
     * tracked by git — never an unbacked "commit-safe" guarantee. Purely
     * informational: like `changedPreferenceKeys`, it never feeds `previewDigest`,
     * so the confirmation binding stays byte-identical.
     */
    workspaceVersioning: OperatingWorkspaceVersioning;
    writes: JournalWrite[];
    componentRoots: string[];
    expectedEventHead: OperatingEventHead;
    resultingEventHead: OperatingEventHead;
}
export declare function prepareOperatingInitialization(input: {
    projectRoot: string;
    profile: OperatingProfile['id'];
    decisionOwner: string;
    planningEngine: OperatingConfig['planningEngine'];
    runtime?: OperatingLocalPreferences['runtime'];
    cadence?: OperatingConfig['cadence'];
    timezone?: string;
    sensitivityCeiling?: OperatingLocalPreferences['sensitivityCeiling'];
    evidenceTtlMs?: number;
    charter?: Partial<OperatingCharter>;
    customProfile?: Partial<OperatingProfile>;
    componentRoots?: string[];
    adapterLeaseDurationMs?: number;
    lastRunAt?: string;
    localRoot?: string;
    now?: string;
}): Promise<OperatingInitializationPreview>;
export declare function applyOperatingInitialization(input: {
    projectRoot: string;
    localRoot?: string;
    preview: OperatingInitializationPreview;
    confirmationDigest: string;
    faultInjector?: (boundary: 'journal-prepared' | 'project-promoted' | 'workspace-roots' | 'preferences' | 'committed') => void | Promise<void>;
}): Promise<{
    initialized: boolean;
    changedPaths: string[];
}>;
export declare function validateOperatingConfiguration(projectRoot: string): Promise<OperatingConfig>;
export declare function operatingProjectKey(projectRoot: string): string;
//# sourceMappingURL=config.d.ts.map