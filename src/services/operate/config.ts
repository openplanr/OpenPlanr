import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spliceManagedBlock } from '../../utils/splice-managed-block.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { OperatingEventStore, operatingRecordsLogLine } from './event-store.js';
import { resolveEvidenceImportPath } from './evidence-import.js';
import {
  applyJournalTransaction,
  type JournalWrite,
  prepareJournalTransaction,
  rollbackJournalTransaction,
} from './journal.js';
import { withOperatingLock } from './lock-service.js';
import type { OperatingDispatchMode } from './mission-dispatch.js';
import {
  prepareOperatingProjectionPersistence,
  renderOperatingProjectionFiles,
} from './projection-persistence.js';
import { assertOperatingArtifact, loadOperatingProtocol } from './protocol.js';
import {
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingCharter,
  type OperatingCheckpoint,
  type OperatingConfig,
  type OperatingEvent,
  type OperatingEventHead,
  type OperatingInitAnswers,
  type OperatingLocalPreferences,
  type OperatingProfile,
  type OperatingRecordEnvelope,
  type OperatingRecoveryRecord,
  type OperatingRoleId,
  type OperatingState,
  type OperatingWorkspaceManifest,
} from './types.js';
import {
  buildWorkspaceManifest,
  ensureOperatingDirectories,
  projectMachineKey,
  resolveOperatingPaths,
  resolveOperatingProject,
} from './workspace.js';

const ALL_ROLES: OperatingConfig['enabledRoles'] = [
  'strategy-finance',
  'technology-risk',
  'product-activation',
  'growth-market',
  'operations-customer',
  'chair',
];

function profile(
  id: OperatingProfile['id'],
  title: string,
  description: string,
  overrides: Partial<OperatingProfile> = {},
): OperatingProfile {
  return {
    id,
    title,
    description,
    enabledRoles: [...ALL_ROLES],
    enabledProviders: ['repository', 'planr', 'git'],
    caps: {
      surfacedFindings: 12,
      newSpecs: 3,
      openDecisions: 5,
      agentArtifacts: 4,
    },
    budgets: {
      maxFiles: 1_000,
      maxItems: 2_000,
      maxBytes: 10 * 1024 * 1024,
      maxDurationMs: 60_000,
    },
    ...overrides,
  };
}

export const OPERATING_PROFILES: readonly OperatingProfile[] = [
  profile('saas', 'SaaS', 'Balanced product, growth, risk, and operating review.'),
  profile('product', 'Product', 'Activation and customer-outcome focused review.', {
    enabledProviders: ['repository', 'planr', 'git', 'github', 'linear'],
  }),
  profile('engineering', 'Engineering', 'Delivery, reliability, and risk focused review.', {
    enabledRoles: ['technology-risk', 'product-activation', 'operations-customer', 'chair'],
    caps: {
      surfacedFindings: 10,
      newSpecs: 3,
      openDecisions: 3,
      agentArtifacts: 2,
    },
  }),
  profile('custom', 'Custom', 'Explicit user-supplied operating configuration.'),
] as const;

export function listOperatingProfiles(): OperatingProfile[] {
  return OPERATING_PROFILES.map((candidate) => structuredClone(candidate));
}

export function getOperatingProfile(id: OperatingProfile['id']): OperatingProfile {
  const candidate = listOperatingProfiles().find((entry) => entry.id === id);
  if (!candidate) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', `Unknown operating profile: ${id}.`);
  }
  return candidate;
}

const CUSTOM_PROFILE_FIELDS = new Set([
  'id',
  'title',
  'description',
  'enabledRoles',
  'enabledProviders',
  'caps',
  'budgets',
]);
const CUSTOM_CAP_FIELDS = new Set([
  'surfacedFindings',
  'newSpecs',
  'openDecisions',
  'agentArtifacts',
]);
const CUSTOM_BUDGET_FIELDS = new Set(['maxFiles', 'maxItems', 'maxBytes', 'maxDurationMs']);
const CUSTOM_PROVIDER_IDS = new Set([
  'repository',
  'planr',
  'git',
  'github',
  'linear',
  'file-import',
]);

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function boundedStringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some((entry) => typeof entry !== 'string' || entry.length > 256)
  ) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `${label} must be a bounded array of strings.`,
    );
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function numericOverrides(
  value: unknown,
  label: string,
  allowed: Set<string>,
): Record<string, number> {
  const record = plainRecord(value, label);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0 || Object.values(record).some((entry) => !Number.isInteger(entry))) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `${label} contains unsupported fields or non-integer values.`,
    );
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, Number(entry)]));
}

/**
 * Strictly allowlists custom-profile data before it can be echoed, persisted,
 * or merged. This is shared by init and profiles validate so unknown fields
 * (including accidental secrets) never reach command results.
 */
export function normalizeCustomOperatingProfile(value: unknown): Partial<OperatingProfile> {
  const record = plainRecord(value, 'Custom profile');
  const unknown = Object.keys(record).filter((key) => !CUSTOM_PROFILE_FIELDS.has(key));
  if (unknown.length > 0 || (record.id !== undefined && record.id !== 'custom')) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Custom profile contains unsupported fields or identity.',
    );
  }
  const normalized: Partial<OperatingProfile> = {};
  if (record.id !== undefined) normalized.id = 'custom';
  for (const key of ['title', 'description'] as const) {
    const entry = record[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 1_024) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `Custom profile ${key} must be a non-empty bounded string.`,
      );
    }
    normalized[key] = entry.trim();
  }
  if (record.enabledRoles !== undefined) {
    const roles = boundedStringArray(record.enabledRoles, 'Custom profile enabledRoles');
    if (roles.length === 0 || roles.some((role) => !ALL_ROLES.includes(role as never))) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Custom profile enabledRoles contains an unknown role or is empty.',
      );
    }
    normalized.enabledRoles = roles as OperatingProfile['enabledRoles'];
  }
  if (record.enabledProviders !== undefined) {
    const providers = boundedStringArray(
      record.enabledProviders,
      'Custom profile enabledProviders',
    );
    if (
      providers.length === 0 ||
      providers.some((provider) => !CUSTOM_PROVIDER_IDS.has(provider))
    ) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Custom profile enabledProviders contains an unknown provider or is empty.',
      );
    }
    normalized.enabledProviders = providers;
  }
  if (record.caps !== undefined) {
    const caps = numericOverrides(record.caps, 'Custom profile caps', CUSTOM_CAP_FIELDS);
    const maxima: Record<string, number> = {
      surfacedFindings: 50,
      newSpecs: 12,
      openDecisions: 20,
      agentArtifacts: 20,
    };
    if (Object.entries(caps).some(([key, entry]) => entry < 1 || entry > maxima[key])) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Custom profile caps exceed the supported safety bounds.',
      );
    }
    normalized.caps = caps as OperatingProfile['caps'];
  }
  if (record.budgets !== undefined) {
    const budgets = numericOverrides(
      record.budgets,
      'Custom profile budgets',
      CUSTOM_BUDGET_FIELDS,
    );
    const withinBounds =
      (budgets.maxFiles === undefined || (budgets.maxFiles >= 1 && budgets.maxFiles <= 10_000)) &&
      (budgets.maxItems === undefined || (budgets.maxItems >= 1 && budgets.maxItems <= 10_000)) &&
      (budgets.maxBytes === undefined ||
        (budgets.maxBytes >= 1_024 && budgets.maxBytes <= 50 * 1024 * 1024)) &&
      (budgets.maxDurationMs === undefined ||
        (budgets.maxDurationMs >= 100 && budgets.maxDurationMs <= 10 * 60_000));
    if (!withinBounds) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Custom profile budgets exceed the supported safety bounds.',
      );
    }
    normalized.budgets = budgets as OperatingProfile['budgets'];
  }
  return normalized;
}

/**
 * Per-project dispatch-mode overrides (FR4 / E-004). A map of role IDs to a
 * `pack | mission` selection that overrides the derived v1.3 registry default.
 *
 * These live in the machine-local `preferences.json`, NOT the schema-frozen
 * `operating-config` artifact: the v1.2 on-disk config surface is frozen
 * (`additionalProperties: false`), so v1.3 dispatch policy is carried in the
 * local operating preferences alongside `sensitivityCeiling` and `runtime`.
 */
export type OperatingDispatchModeOverrides = Record<OperatingRoleId, OperatingDispatchMode>;

type OperatingPreferencesRecord = OperatingLocalPreferences & {
  dispatchModeOverrides?: OperatingDispatchModeOverrides;
  /**
   * FR8 / E-008 cadence marker: the RFC 3339 UTC instant of the most recent cycle
   * that reached a terminal reviewable/blocked/closed state. Machine-local, next
   * to `dispatchModeOverrides` — the schema-frozen `operating-config` artifact
   * never carries it. Absent until the first cycle completes (weekly/monthly then
   * become due immediately per the pipeline calculator).
   */
  lastRunAt?: string;
};

const DISPATCH_MODES = new Set<OperatingDispatchMode>(['pack', 'mission']);

/**
 * Strictly allowlist per-project dispatch-mode overrides before they are echoed,
 * persisted, or consumed by dispatch — mirroring the `normalizeCustomOperatingProfile`
 * pattern. Keys must be known registry role IDs; values must be exactly `pack`
 * or `mission`. Unknown roles or values fail closed with `E_OPERATE_CONFIG_INVALID`.
 */
export function normalizeOperatingDispatchModeOverrides(
  value: unknown,
): OperatingDispatchModeOverrides {
  const record = plainRecord(value, 'dispatchModeOverrides');
  const entries = Object.entries(record);
  if (entries.length > ALL_ROLES.length) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'dispatchModeOverrides contains more entries than there are operating roles.',
    );
  }
  const normalized = {} as OperatingDispatchModeOverrides;
  for (const [roleId, mode] of entries) {
    if (!ALL_ROLES.includes(roleId as OperatingRoleId)) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `dispatchModeOverrides references an unknown role: ${roleId}.`,
      );
    }
    if (typeof mode !== 'string' || !DISPATCH_MODES.has(mode as OperatingDispatchMode)) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `dispatchModeOverrides value for ${roleId} must be "pack" or "mission".`,
      );
    }
    normalized[roleId as OperatingRoleId] = mode as OperatingDispatchMode;
  }
  return normalized;
}

/**
 * Parse repeatable `--dispatch-mode-override <roleId>=<pack|mission>` CLI tokens
 * into a validated override map. Each token must be exactly `roleId=mode`.
 */
export function parseOperatingDispatchModeOverrideFlags(
  flags: readonly string[] = [],
): OperatingDispatchModeOverrides {
  const raw: Record<string, string> = {};
  for (const flag of flags) {
    const separator = flag.indexOf('=');
    if (separator <= 0) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `--dispatch-mode-override must be "<roleId>=<pack|mission>", received "${flag}".`,
      );
    }
    const roleId = flag.slice(0, separator).trim();
    const mode = flag.slice(separator + 1).trim();
    if (raw[roleId] && raw[roleId] !== mode) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `--dispatch-mode-override sets conflicting modes for role ${roleId}.`,
      );
    }
    raw[roleId] = mode;
  }
  return normalizeOperatingDispatchModeOverrides(raw);
}

async function readOperatingPreferencesRecord(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingPreferencesRecord | null> {
  const paths = resolveOperatingPaths(projectRoot, { localRoot: options.localRoot });
  const raw = await readFile(path.join(paths.localRoot, 'preferences.json'), 'utf8').catch(
    () => null,
  );
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as OperatingPreferencesRecord;
  } catch {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Operating preferences.json is not valid JSON.',
    );
  }
}

/** Read the validated per-project dispatch-mode overrides, or `{}` when none set. */
export async function readOperatingDispatchModeOverrides(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<OperatingDispatchModeOverrides> {
  const preferences = await readOperatingPreferencesRecord(projectRoot, options);
  if (!preferences?.dispatchModeOverrides) return {} as OperatingDispatchModeOverrides;
  return normalizeOperatingDispatchModeOverrides(preferences.dispatchModeOverrides);
}

/**
 * Merge validated dispatch-mode overrides into the machine-local preferences and
 * persist atomically (temp + rename, mode 0o600), matching how initialization
 * writes preferences.json. An override set to the registry default can be
 * cleared by omitting it. Requires the project to have been initialized.
 */
export async function applyOperatingDispatchModeOverrides(input: {
  projectRoot: string;
  localRoot?: string;
  overrides: OperatingDispatchModeOverrides;
}): Promise<{ dispatchModeOverrides: OperatingDispatchModeOverrides; changed: boolean }> {
  const preferences = await readOperatingPreferencesRecord(input.projectRoot, {
    localRoot: input.localRoot,
  });
  if (!preferences) {
    throw new OperateError(
      'E_OPERATE_NOT_INITIALIZED',
      'Operating Board is not initialized in this project; run `planr operate init` first.',
    );
  }
  const validated = normalizeOperatingDispatchModeOverrides(input.overrides);
  const merged: OperatingDispatchModeOverrides = {
    ...(preferences.dispatchModeOverrides ?? ({} as OperatingDispatchModeOverrides)),
    ...validated,
  };
  const next: OperatingPreferencesRecord = { ...preferences };
  if (Object.keys(merged).length > 0) next.dispatchModeOverrides = merged;
  else delete next.dispatchModeOverrides;
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const preferencePath = path.join(paths.localRoot, 'preferences.json');
  const before = await readFile(preferencePath, 'utf8').catch(() => null);
  const serialized = `${canonicalize(next)}\n`;
  const changed = before !== serialized;
  if (changed) {
    await mkdir(paths.localRoot, { recursive: true, mode: 0o700 });
    const temporary = `${preferencePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    await rename(temporary, preferencePath);
  }
  return { dispatchModeOverrides: merged, changed };
}

/**
 * Read the persisted per-project cadence `lastRunAt` marker (FR8 / E-008), or
 * `null` when no cycle has completed yet. Machine-local, alongside
 * `dispatchModeOverrides`.
 */
export async function readOperatingLastRunAt(
  projectRoot: string,
  options: { localRoot?: string } = {},
): Promise<string | null> {
  const preferences = await readOperatingPreferencesRecord(projectRoot, options);
  const value = preferences?.lastRunAt;
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Persist the per-project cadence `lastRunAt` marker into the machine-local
 * preferences atomically (temp + rename, mode 0o600), matching how dispatch-mode
 * overrides are written. FR8 / E-008: recorded whenever a cycle reaches
 * reviewable/blocked/closed so `operate status` can surface the pipeline's
 * `nextDueAt` under an injected clock. `lastRunAt` is the injected cycle instant,
 * never a wall-clock read here. Requires an initialized project.
 */
export async function recordOperatingLastRunAt(input: {
  projectRoot: string;
  localRoot?: string;
  lastRunAt: string;
}): Promise<{ lastRunAt: string; changed: boolean }> {
  const preferences = await readOperatingPreferencesRecord(input.projectRoot, {
    localRoot: input.localRoot,
  });
  if (!preferences) {
    throw new OperateError(
      'E_OPERATE_NOT_INITIALIZED',
      'Operating Board is not initialized in this project; run `planr operate init` first.',
    );
  }
  const next: OperatingPreferencesRecord = { ...preferences, lastRunAt: input.lastRunAt };
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const preferencePath = path.join(paths.localRoot, 'preferences.json');
  const before = await readFile(preferencePath, 'utf8').catch(() => null);
  const serialized = `${canonicalize(next)}\n`;
  const changed = before !== serialized;
  if (changed) {
    await mkdir(paths.localRoot, { recursive: true, mode: 0o700 });
    const temporary = `${preferencePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    await rename(temporary, preferencePath);
  }
  return { lastRunAt: input.lastRunAt, changed };
}

export function normalizeCharter(input: Partial<OperatingCharter> = {}): OperatingCharter {
  const list = (values: string[] | undefined): string[] => [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  return {
    purpose: input.purpose?.trim() ?? '',
    stage: input.stage?.trim() ?? '',
    businessModel: input.businessModel?.trim() ?? '',
    idealCustomer: input.idealCustomer?.trim() ?? '',
    goals: list(input.goals),
    constraints: list(input.constraints),
    successMetrics: list(input.successMetrics),
    guardrails: list(input.guardrails),
    knownUnknowns: list(input.knownUnknowns),
  };
}

/** Normalize already-validated questionnaire or explicit CLI answers once. */
export function normalizeOperatingInitializationAnswers(
  input: OperatingInitAnswers,
): OperatingInitAnswers {
  const list = (values: string[] | undefined): string[] | undefined =>
    values === undefined
      ? undefined
      : [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return {
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    ...(input.profileFile?.trim() ? { profileFile: input.profileFile.trim() } : {}),
    ...(input.decisionOwner?.trim() ? { decisionOwner: input.decisionOwner.trim() } : {}),
    ...(input.planningEngine === undefined ? {} : { planningEngine: input.planningEngine }),
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
    ...(input.cadence === undefined ? {} : { cadence: input.cadence }),
    ...(input.timezone?.trim() ? { timezone: input.timezone.trim() } : {}),
    ...(input.sensitivityCeiling === undefined
      ? {}
      : { sensitivityCeiling: input.sensitivityCeiling }),
    ...(input.sources === undefined ? {} : { sources: list(input.sources) ?? [] }),
    ...(input.evidenceFiles === undefined
      ? {}
      : { evidenceFiles: list(input.evidenceFiles) ?? [] }),
    ...(input.componentRoots === undefined
      ? {}
      : { componentRoots: list(input.componentRoots) ?? [] }),
    ...(input.charter === undefined ? {} : { charter: normalizeCharter(input.charter) }),
  };
}

function markdownList(values: string[], fallback: string): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : `- ${fallback}`;
}

export function renderOperatingCharter(
  config: OperatingConfig,
  input: Partial<OperatingCharter> = {},
): string {
  const charter = normalizeCharter(input);
  return [
    '# Operating charter',
    '',
    `Decision owner: ${config.decisionOwner}`,
    `Planning engine: ${config.planningEngine}`,
    `Profile: ${config.profile}`,
    '',
    '## Product context',
    '',
    `- Purpose: ${charter.purpose || '[unknown — answer before dependent routes]'}`,
    `- Stage: ${charter.stage || '[unknown]'}`,
    `- Business model: ${charter.businessModel || '[unknown]'}`,
    `- Ideal customer: ${charter.idealCustomer || '[unknown]'}`,
    '',
    '## Current goals',
    '',
    markdownList(charter.goals, '[unknown]'),
    '',
    '## Constraints',
    '',
    markdownList(charter.constraints, '[none recorded]'),
    '',
    '## Success metrics',
    '',
    markdownList(
      charter.successMetrics,
      '[unknown — numeric claims require a source and observation window]',
    ),
    '',
    '## Guardrails',
    '',
    markdownList(
      charter.guardrails,
      'No external or irreversible action without explicit human authority.',
    ),
    '',
    '## Known unknowns',
    '',
    markdownList(charter.knownUnknowns, 'Complete the missing product context above.'),
  ].join('\n');
}

export interface OperatingInitializationPreview {
  config: OperatingConfig;
  preferences: OperatingLocalPreferences;
  charter: string;
  workspace: OperatingWorkspaceManifest;
  previewDigest: `sha256:${string}`;
  changedPaths: string[];
  preferencesChanged: boolean;
  writes: JournalWrite[];
  componentRoots: string[];
  expectedEventHead: OperatingEventHead;
  resultingEventHead: OperatingEventHead;
}

const INITIALIZATION_RECOVERY_ID = 'RCV-operating-board-initialized';
const INITIALIZATION_CORRELATION_ID = 'operate-initialization-v1';

// Protocol v1.3 (FR5/E-005) init layout: internals collapse under `.state/`
// (events.jsonl, records.jsonl, checkpoint.json). Fresh `operate init` writes
// this layout directly — there is no SPEC-002 tree to migrate for a new project.
const OPERATE_STATE_EVENTS = '.planr/operate/.state/events.jsonl';
const OPERATE_STATE_RECORDS = '.planr/operate/.state/records.jsonl';
const OPERATE_STATE_CHECKPOINT = '.planr/operate/.state/checkpoint.json';

async function buildInitialOperatingState(input: {
  projectRoot: string;
  createdAt: string;
  config: OperatingConfig;
  workspace: OperatingWorkspaceManifest;
}): Promise<{
  event: OperatingEvent;
  record: OperatingRecordEnvelope;
  checkpoint: OperatingCheckpoint;
  state: OperatingState;
  writes: JournalWrite[];
}> {
  const protocol = await loadOperatingProtocol();
  const genesis: OperatingEventHead = { sequence: 0, hash: null };
  const recovery: OperatingRecoveryRecord = {
    kind: 'operating-recovery-record',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: INITIALIZATION_RECOVERY_ID,
    transactionId: null,
    action: 'rebuild-projection',
    reason: 'Operating Board initialized with a verified canonical event and checkpoint.',
    previewDigest: canonicalDigest({
      kind: 'operating-initialization',
      config: input.config,
      workspaceDigest: input.workspace.workspaceDigest,
    }),
    fromHead: genesis,
    // The recovery record is created before the event that references it. The
    // event and checkpoint carry the authoritative resulting hash.
    toHead: { sequence: 1, hash: null },
    outcome: 'recovered',
    confirmedBy: 'operate-cli',
    createdAt: input.createdAt,
  };
  await assertOperatingArtifact('operating-recovery-record', recovery);
  const contentDigest = canonicalDigest(recovery);
  const digest = canonicalDigest({
    recordType: 'recovery',
    createdAt: input.createdAt,
    correlationId: INITIALIZATION_CORRELATION_ID,
    contentDigest,
  });
  const record: OperatingRecordEnvelope = {
    kind: 'operating-record',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    digest,
    recordType: 'recovery',
    createdAt: input.createdAt,
    correlationId: INITIALIZATION_CORRELATION_ID,
    contentDigest,
    content: recovery as unknown as Record<string, unknown>,
  };
  await assertOperatingArtifact('operating-record', record);
  const event = protocol.createOperatingEvent(
    {
      eventId: INITIALIZATION_CORRELATION_ID,
      timestamp: input.createdAt,
      cycleId: 'CYCLE-000',
      type: 'projection.rebuilt',
      entityId: INITIALIZATION_RECOVERY_ID,
      actor: { kind: 'engine', id: 'openplanr' },
      causationId: null,
      correlationId: INITIALIZATION_CORRELATION_ID,
      evidenceRefs: [],
      payload: { recordDigest: record.digest },
    },
    { previousEvent: null, sequence: 1 },
  );
  const state = protocol.reduceOperatingEvents([event]);
  const checkpoint = protocol.createOperatingCheckpoint(state, {
    createdAt: input.createdAt,
    recordDigests: [record.digest],
  });
  await Promise.all([
    assertOperatingArtifact('operating-event', event),
    assertOperatingArtifact('operating-state', state),
    assertOperatingArtifact('operating-checkpoint', checkpoint),
  ]);
  const projection = await prepareOperatingProjectionPersistence({
    projectRoot: input.projectRoot,
    state,
  });
  const projectionByPath = new Map(projection.files.map((file) => [file.relativePath, file]));
  const writes: JournalWrite[] = [
    {
      relativePath: OPERATE_STATE_RECORDS,
      content: `${operatingRecordsLogLine(record)}\n`,
      operation: 'create',
    },
    {
      relativePath: OPERATE_STATE_CHECKPOINT,
      content: `${canonicalize(checkpoint)}\n`,
    },
    ...renderOperatingProjectionFiles(state).map((file) => ({
      relativePath: file.relativePath,
      content: projectionByPath.get(file.relativePath)?.content ?? file.content,
    })),
    // Keep the canonical event last: journal head revalidation remains at
    // genesis for every preceding write, then changes exactly once.
    {
      relativePath: OPERATE_STATE_EVENTS,
      content: `${canonicalize(event)}\n`,
      operation: 'create' as const,
    },
  ];
  return { event, record, checkpoint, state, writes };
}

export async function prepareOperatingInitialization(input: {
  projectRoot: string;
  profile: OperatingProfile['id'];
  decisionOwner: string;
  planningEngine: OperatingConfig['planningEngine'];
  runtime?: OperatingLocalPreferences['runtime'];
  cadence?: OperatingConfig['cadence'];
  timezone?: string;
  sensitivityCeiling?: OperatingLocalPreferences['sensitivityCeiling'];
  evidenceTtlMs?: number;
  enabledProviders?: string[];
  evidenceFiles?: string[];
  charter?: Partial<OperatingCharter>;
  customProfile?: Partial<OperatingProfile>;
  componentRoots?: string[];
  dispatchModeOverrides?: OperatingDispatchModeOverrides;
  localRoot?: string;
  now?: string;
}): Promise<OperatingInitializationPreview> {
  if (!input.decisionOwner.trim()) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Operating initialization requires a decision owner.',
    );
  }
  const base = getOperatingProfile(input.profile);
  const customProfile =
    input.profile === 'custom'
      ? normalizeCustomOperatingProfile(input.customProfile ?? {})
      : undefined;
  const selected =
    input.profile === 'custom'
      ? {
          ...base,
          ...customProfile,
          caps: { ...base.caps, ...customProfile?.caps },
          budgets: { ...base.budgets, ...customProfile?.budgets },
        }
      : base;
  const requestedEvidenceFiles = [
    ...new Set((input.evidenceFiles ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  const requestedProviders = [
    ...new Set([
      ...(input.enabledProviders ?? selected.enabledProviders),
      ...(requestedEvidenceFiles.length > 0 ? ['file-import'] : []),
    ]),
  ].sort();
  if (requestedProviders.includes('file-import') && requestedEvidenceFiles.length === 0) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'The file-import source requires at least one --evidence-file JSON or CSV path.',
    );
  }
  const config: OperatingConfig = {
    kind: 'operating-config',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    profile: input.profile,
    decisionOwner: input.decisionOwner.trim(),
    cadence: input.cadence ?? 'manual',
    planningEngine: input.planningEngine,
    enabledRoles: [...selected.enabledRoles],
    enabledProviders: requestedProviders,
    caps: { ...selected.caps },
    budgets: { ...selected.budgets },
  };
  const caps = config.caps;
  const capBounds: Array<[keyof typeof caps, number]> = [
    ['surfacedFindings', 50],
    ['newSpecs', 12],
    ['openDecisions', 20],
    ['agentArtifacts', 20],
  ];
  for (const [name, maximum] of capBounds) {
    if (!Number.isInteger(caps[name]) || caps[name] < 1 || caps[name] > maximum) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        `${name} must be an integer from 1 to ${maximum}.`,
      );
    }
  }
  if (
    !Number.isInteger(config.budgets.maxFiles) ||
    config.budgets.maxFiles < 1 ||
    config.budgets.maxFiles > 10_000 ||
    !Number.isInteger(config.budgets.maxItems) ||
    config.budgets.maxItems < 1 ||
    config.budgets.maxItems > 10_000 ||
    !Number.isInteger(config.budgets.maxBytes) ||
    config.budgets.maxBytes < 1_024 ||
    config.budgets.maxBytes > 50 * 1024 * 1024 ||
    !Number.isInteger(config.budgets.maxDurationMs) ||
    config.budgets.maxDurationMs < 100 ||
    config.budgets.maxDurationMs > 10 * 60_000
  ) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Custom evidence budgets exceed the supported safety bounds.',
    );
  }
  await assertOperatingArtifact('operating-config', config);
  const timezone = input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', `Invalid IANA timezone: ${timezone}.`);
  }
  const evidenceTtlMs = input.evidenceTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  if (
    !Number.isInteger(evidenceTtlMs) ||
    evidenceTtlMs < 60 * 60 * 1_000 ||
    evidenceTtlMs > 30 * 24 * 60 * 60 * 1_000
  ) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Evidence TTL must be between one hour and 30 days.',
    );
  }
  const componentRoots = [...new Set(input.componentRoots ?? [])];
  let workspace = await buildWorkspaceManifest(input.projectRoot, componentRoots, {
    capturedAt: input.now,
    localRoot: input.localRoot,
    persistRoots: false,
  });
  const controlRoot = await resolveOperatingProject(input.projectRoot);
  const resolvedImportPaths: string[] = [];
  for (const configuredPath of requestedEvidenceFiles) {
    const resolved = await resolveEvidenceImportPath(input.projectRoot, configuredPath, [
      { componentId: workspace.controlRepository.componentId, root: controlRoot },
      ...componentRoots.map((root, index) => ({
        componentId: workspace.components[index]?.componentId ?? `component-${index + 1}`,
        root,
      })),
    ]);
    resolvedImportPaths.push(resolved.absolutePath);
  }
  // Dispatch-mode overrides are validated once here and carried in the
  // machine-local preferences (the v1.2 config artifact surface is frozen).
  // Omitted entirely when empty so a project with no overrides keeps a
  // byte-identical preferences payload and preview digest.
  const dispatchModeOverrides = input.dispatchModeOverrides
    ? normalizeOperatingDispatchModeOverrides(input.dispatchModeOverrides)
    : ({} as OperatingDispatchModeOverrides);
  const preferences: OperatingPreferencesRecord = {
    runtime: input.runtime ?? 'auto',
    timezone,
    sensitivityCeiling: input.sensitivityCeiling ?? 'internal',
    evidenceTtlMs,
    enabledSources: [...config.enabledProviders],
    ...(resolvedImportPaths.length > 0
      ? { importPaths: [...new Set(resolvedImportPaths)].sort() }
      : {}),
    ...(Object.keys(dispatchModeOverrides).length > 0 ? { dispatchModeOverrides } : {}),
  };
  const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
  const existingWorkspace = await readFile(paths.workspace, 'utf8')
    .then(async (raw) => {
      const parsed = JSON.parse(raw) as OperatingWorkspaceManifest;
      await assertOperatingArtifact('operating-workspace-manifest', parsed);
      return parsed;
    })
    .catch(() => null);
  if (
    existingWorkspace &&
    existingWorkspace.workspaceDigest === workspace.workspaceDigest &&
    canonicalDigest(existingWorkspace.controlRepository) ===
      canonicalDigest(workspace.controlRepository) &&
    canonicalDigest(existingWorkspace.components) === canonicalDigest(workspace.components)
  ) {
    // Repeated init must be byte-idempotent. Preserve the original capture
    // time when the verified repository descriptors have not changed.
    workspace = existingWorkspace;
  }
  const expectedPreferences = `${canonicalize(preferences)}\n`;
  const currentPreferences = await readFile(
    path.join(paths.localRoot, 'preferences.json'),
    'utf8',
  ).catch(() => null);
  const preferencesChanged = currentPreferences !== expectedPreferences;
  const existingCharter = await readFile(paths.charter, 'utf8').catch(() => '');
  const charter = spliceManagedBlock(
    existingCharter,
    'operate-charter',
    renderOperatingCharter(config, input.charter),
  );
  const writes: JournalWrite[] = [
    { relativePath: '.planr/operate/config.json', content: `${canonicalize(config)}\n` },
    { relativePath: '.planr/operate/charter.md', content: charter },
    { relativePath: '.planr/operate/workspace.json', content: `${canonicalize(workspace)}\n` },
  ];
  const existingEvents = await readFile(paths.events, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  let expectedEventHead: OperatingEventHead = { sequence: 0, hash: null };
  let resultingEventHead: OperatingEventHead = { sequence: 0, hash: null };
  if (existingEvents.trim()) {
    const replay = await new OperatingEventStore(input.projectRoot, {
      localRoot: input.localRoot,
    }).replay();
    expectedEventHead = replay.eventHead;
    resultingEventHead = replay.eventHead;
  } else {
    const initial = await buildInitialOperatingState({
      projectRoot: input.projectRoot,
      createdAt: workspace.capturedAt,
      config,
      workspace,
    });
    resultingEventHead = {
      sequence: initial.event.sequence,
      hash: initial.event.eventHash,
    };
    writes.push(...initial.writes);
  }
  const changedPaths: string[] = [];
  for (const write of writes) {
    const current = await readFile(path.join(input.projectRoot, write.relativePath)).catch(
      () => null,
    );
    const next = Buffer.from(write.content);
    if (!current || sha256Digest(current) !== sha256Digest(next)) {
      changedPaths.push(write.relativePath);
    }
  }
  const exactWrites = writes.map((write) => ({
    relativePath: write.relativePath,
    operation: write.operation ?? 'replace',
    contentDigest: sha256Digest(write.content),
  }));
  const previewDigest = canonicalDigest({
    config,
    preferences,
    charterDigest: sha256Digest(charter),
    workspaceDigest: workspace.workspaceDigest,
    expectedEventHead,
    resultingEventHead,
    exactWrites,
    changedPaths,
    preferencesChanged,
  });
  return {
    config,
    preferences,
    charter,
    workspace,
    previewDigest,
    changedPaths,
    preferencesChanged,
    writes,
    componentRoots,
    expectedEventHead,
    resultingEventHead,
  };
}

export async function applyOperatingInitialization(input: {
  projectRoot: string;
  localRoot?: string;
  preview: OperatingInitializationPreview;
  confirmationDigest: string;
  faultInjector?: (
    boundary:
      | 'journal-prepared'
      | 'project-promoted'
      | 'workspace-roots'
      | 'preferences'
      | 'committed',
  ) => void | Promise<void>;
}): Promise<{ initialized: boolean; changedPaths: string[] }> {
  if (input.confirmationDigest !== input.preview.previewDigest) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Initialization requires confirmation of the exact preview digest.',
    );
  }
  const currentWorkspace = await buildWorkspaceManifest(
    input.projectRoot,
    input.preview.componentRoots,
    {
      capturedAt: input.preview.workspace.capturedAt,
      localRoot: input.localRoot,
      persistRoots: false,
    },
  );
  if (currentWorkspace.workspaceDigest !== input.preview.workspace.workspaceDigest) {
    throw new OperateError(
      'E_OPERATE_ROUTE_DRIFT',
      'Workspace revisions changed after initialization preview.',
    );
  }
  const paths = await ensureOperatingDirectories(input.projectRoot, {
    localRoot: input.localRoot,
  });
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  if (
    initial.eventHead.sequence !== input.preview.expectedEventHead.sequence ||
    initial.eventHead.hash !== input.preview.expectedEventHead.hash
  ) {
    throw new OperateError(
      'E_OPERATE_ROUTE_DRIFT',
      'Operating state changed after initialization preview.',
      {
        changedDimensions: ['eventHead'],
        expectedEventHead: input.preview.expectedEventHead,
        currentEventHead: initial.eventHead,
      },
    );
  }
  await withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: input.preview.expectedEventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const preferencePath = path.join(paths.localRoot, 'preferences.json');
      const beforeRoots = await readFile(paths.roots).catch(() => null);
      const beforePreferences = await readFile(preferencePath).catch(() => null);
      const restorePrivate = async (): Promise<void> => {
        for (const [target, before] of [
          [paths.roots, beforeRoots],
          [preferencePath, beforePreferences],
        ] as const) {
          if (before) await writeFile(target, before, { mode: 0o600 });
          else await unlink(target).catch(() => undefined);
        }
      };
      const journal =
        input.preview.changedPaths.length > 0
          ? await prepareJournalTransaction(input.projectRoot, {
              writes: input.preview.writes.filter((write) =>
                input.preview.changedPaths.includes(write.relativePath),
              ),
              eventHead: initial.eventHead,
              previewDigest: input.preview.previewDigest,
              localRoot: input.localRoot,
            })
          : null;
      let advancedHead = false;
      try {
        if (journal) await input.faultInjector?.('journal-prepared');
        if (journal) {
          await applyJournalTransaction(input.projectRoot, journal, {
            currentEventHead: initial.eventHead,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          });
          await input.faultInjector?.('project-promoted');
          if (
            input.preview.resultingEventHead.sequence !== initial.eventHead.sequence ||
            input.preview.resultingEventHead.hash !== initial.eventHead.hash
          ) {
            const actual = (await store.replay()).eventHead;
            if (
              actual.sequence !== input.preview.resultingEventHead.sequence ||
              actual.hash !== input.preview.resultingEventHead.hash
            ) {
              throw new OperateError(
                'E_OPERATE_HEAD_DIVERGED',
                'Initialization did not produce the confirmed canonical event head.',
              );
            }
            await lock.advanceEventHead(initial.eventHead, actual);
            advancedHead = true;
          }
        }
        await input.faultInjector?.('workspace-roots');
        await buildWorkspaceManifest(input.projectRoot, input.preview.componentRoots, {
          capturedAt: input.preview.workspace.capturedAt,
          localRoot: input.localRoot,
          persistRoots: true,
        });
        await input.faultInjector?.('preferences');
        await mkdir(paths.localRoot, { recursive: true, mode: 0o700 });
        const temporary = `${preferencePath}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${canonicalize(input.preview.preferences)}\n`, { mode: 0o600 });
        await rename(temporary, preferencePath);
        await input.faultInjector?.('committed');
      } catch (error) {
        await restorePrivate().catch(() => undefined);
        if (journal) {
          await rollbackJournalTransaction(input.projectRoot, journal).catch(() => undefined);
        }
        if (advancedHead) {
          await lock
            .advanceEventHead(input.preview.resultingEventHead, initial.eventHead)
            .catch(() => undefined);
        }
        throw error;
      }
    },
  );
  return {
    initialized: input.preview.changedPaths.length > 0 || input.preview.preferencesChanged,
    changedPaths: [...input.preview.changedPaths],
  };
}

export async function validateOperatingConfiguration(
  projectRoot: string,
): Promise<OperatingConfig> {
  const paths = resolveOperatingPaths(projectRoot);
  let config: OperatingConfig;
  try {
    config = JSON.parse(await readFile(paths.config, 'utf8')) as OperatingConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new OperateError(
        'E_OPERATE_NOT_INITIALIZED',
        'Operating Board is not initialized for this project.',
        { recoveryCommand: 'planr operate init' },
      );
    }
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Operating Board configuration is not valid JSON.',
    );
  }
  await assertOperatingArtifact('operating-config', config);
  const protocol = await loadOperatingProtocol();
  const knownRoles = new Set(protocol.listOperatingRoles().map((entry) => entry.id));
  const knownProviders = new Set(protocol.listOperatingProviders().map((entry) => entry.id));
  if (config.enabledRoles.some((role) => !knownRoles.has(role))) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Configuration has an unknown role.');
  }
  if (config.enabledProviders.some((provider) => !knownProviders.has(provider))) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Configuration has an unknown provider.');
  }
  return config;
}

export function operatingProjectKey(projectRoot: string): string {
  return `operate-${projectMachineKey(projectRoot)}`;
}
