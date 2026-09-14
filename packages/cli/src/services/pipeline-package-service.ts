import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256CanonicalJson } from './canonical-json.js';

const require = createRequire(import.meta.url);

export interface PipelinePackage {
  root: string;
  version: string;
  binPath: string;
  adapterRegistryPath: string;
  roleRegistryPath: string;
}

export interface PipelinePackageHandoff {
  readonly archiveDigest: `sha256:${string}`;
  readonly packageRoot: string;
  readonly sourceInventoryDigest: `sha256:${string}`;
  readonly contractCatalogDigest: `sha256:${string}`;
}

export interface PipelinePackageHandoffVerificationOptions {
  readonly archivePath?: string;
}

const PIPELINE_ROOT_API_NAMES = [
  'LIVE_EVIDENCE_ABSENCE_KINDS_V2',
  'LIVE_EVIDENCE_EFFECT_CLASS_V2',
  'LIVE_EVIDENCE_PORTABLE_AUTHORITY_V2',
  'OPERATING_OUTCOME_EVALUATION_OPERATORS_V2',
  'OperatingLiveEvidenceErrorV2',
  'assertAcceptedLiveEvidenceBridgeV2',
  'assertAcceptedLiveEvidenceSourceV2',
  'assertLiveEvidenceProviderRegistrationV2',
  'assertLiveEvidenceProviderRegistryV2',
  'assertOperatingConnectorCheckpointV2',
  'assertOperatingEvidenceObservationV2',
  'assertOperatingLearningReceiptV2',
  'assertOperatingLiveEvidenceConsentRecordV2',
  'assertOperatingLiveEvidenceIngestionV2',
  'assertOperatingMeasurementPlanV2',
  'assertOperatingMeasurementScheduleReceiptV2',
  'assertOperatingMeasurementScheduleV2',
  'assertOperatingOutcomeEvaluationV2',
  'deriveOperatingLiveEvidenceContentDigestV2',
  'deriveOperatingLiveEvidenceRequestHashV2',
  'evaluateOperatingOutcomeV2',
  'reduceOperatingConnectorCheckpointV2',
  'reduceOperatingMeasurementScheduleV2',
  'registerLiveEvidenceProviderV2',
  'LANDING_PORTABLE_AUTHORITY',
  'LANDING_PROTOCOL_VERSION',
  'LANDING_SHIP_PROTOCOL_VERSION',
  'LandingContractError',
  'assertLandingConfirmation',
  'assertLandingEvent',
  'assertLandingOperationRegistry',
  'assertLandingPhaseReceipt',
  'assertLandingPlan',
  'assertLandingReceipt',
  'createLandingEventState',
  'reduceLandingEvents',
] as const;

const PIPELINE_PROTOCOL_API_NAMES = [
  'LANDING_CONTRACT_KINDS_V1',
  'OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2',
  'OPERATE_RUNTIME_CONTRACT_KINDS',
  'loadLandingContract',
  'loadOperateLiveEvidenceContract',
  'loadOperateRuntimeContract',
  'loadProtocolContract',
] as const;

const PIPELINE_EVIDENCE_API_NAMES = ['OPEN_REFERENCE_EVIDENCE_REGISTRY_V2'] as const;

const PACKAGE_B_LIVE_EVIDENCE_PROVIDERS = [
  'business-metrics',
  'deployment-health',
  'github-delivery',
  'linear-jira-work',
  'posthog-product',
  'sentry-error',
] as const;

const LIVE_EVIDENCE_CONTRACT_KINDS = [
  'operate-live-evidence-provider-registration',
  'operate-live-evidence-provider-registry',
  'operating-live-evidence-consent-record',
  'operating-connector-checkpoint',
  'operating-live-evidence-ingestion',
  'operating-measurement-plan',
  'operating-measurement-schedule',
  'operating-measurement-schedule-receipt',
  'operating-evidence-observation',
  'operating-outcome-evaluation',
  'operating-learning-receipt',
] as const;

const LANDING_CONTRACT_KINDS = [
  'landing-plan',
  'landing-confirmation',
  'landing-event',
  'landing-phase-receipt',
  'landing-receipt',
  'landing-operation-registry',
] as const;

const ROOT_FUNCTION_API_NAMES = new Set<string>([
  'OperatingLiveEvidenceErrorV2',
  'assertAcceptedLiveEvidenceBridgeV2',
  'assertAcceptedLiveEvidenceSourceV2',
  'assertLiveEvidenceProviderRegistrationV2',
  'assertLiveEvidenceProviderRegistryV2',
  'assertOperatingConnectorCheckpointV2',
  'assertOperatingEvidenceObservationV2',
  'assertOperatingLearningReceiptV2',
  'assertOperatingLiveEvidenceConsentRecordV2',
  'assertOperatingLiveEvidenceIngestionV2',
  'assertOperatingMeasurementPlanV2',
  'assertOperatingMeasurementScheduleReceiptV2',
  'assertOperatingMeasurementScheduleV2',
  'assertOperatingOutcomeEvaluationV2',
  'deriveOperatingLiveEvidenceContentDigestV2',
  'deriveOperatingLiveEvidenceRequestHashV2',
  'evaluateOperatingOutcomeV2',
  'reduceOperatingConnectorCheckpointV2',
  'reduceOperatingMeasurementScheduleV2',
  'registerLiveEvidenceProviderV2',
  'LandingContractError',
  'assertLandingConfirmation',
  'assertLandingEvent',
  'assertLandingOperationRegistry',
  'assertLandingPhaseReceipt',
  'assertLandingPlan',
  'assertLandingReceipt',
  'createLandingEventState',
  'reduceLandingEvents',
]);

export type PipelineRootApiName = (typeof PIPELINE_ROOT_API_NAMES)[number];
export type PipelineProtocolApiName = (typeof PIPELINE_PROTOCOL_API_NAMES)[number];
export type PipelineEvidenceApiName = (typeof PIPELINE_EVIDENCE_API_NAMES)[number];

export interface VerifiedPipelinePackageHandoff extends PipelinePackageHandoff {
  readonly archiveVerification: 'verified' | 'externally-preverified';
  readonly publicEntries: Readonly<{
    root: string;
    protocol: string;
    evidence: string;
  }>;
  readonly rootApi: Readonly<Record<PipelineRootApiName, unknown>>;
  readonly protocolApi: Readonly<Record<PipelineProtocolApiName, unknown>>;
  readonly evidenceApi: Readonly<Record<PipelineEvidenceApiName, unknown>>;
  readonly registryValues: Readonly<{
    liveEvidenceProviderRegistry: Readonly<Record<string, unknown>>;
    baseEvidenceRegistry: Readonly<Record<string, unknown>>;
  }>;
  readonly assets: Readonly<{
    contractCatalog: string;
    operateContractRegistry: string;
    liveEvidenceProviderRegistry: string;
    landingOperationRegistry: string;
    liveEvidenceSchemas: readonly Readonly<{ kind: string; path: string }>[];
    landingSchemas: readonly Readonly<{ kind: string; path: string }>[];
  }>;
}

export type PipelinePackageHandoffErrorCode =
  | 'E_PIPELINE_HANDOFF_INVALID'
  | 'E_PIPELINE_HANDOFF_UNSAFE'
  | 'E_PIPELINE_HANDOFF_DIGEST_MISMATCH'
  | 'E_PIPELINE_HANDOFF_INCOMPATIBLE';

/** Node error codes are enum-like tokens; anything else may embed a path this boundary withholds. */
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u;

/**
 * The identity of a caught error, without the filesystem paths this boundary deliberately
 * withholds. `ERR_MODULE_NOT_FOUND` alone distinguishes a missing dependency from a changed API.
 */
function causeCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const { code } = error as NodeJS.ErrnoException;
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : null;
}

function withCauseCode(message: string, error: unknown): string {
  const code = causeCode(error);
  return code === null ? message : `${message} (${code})`;
}

export class PipelinePackageHandoffError extends Error {
  readonly code: PipelinePackageHandoffErrorCode;

  constructor(code: PipelinePackageHandoffErrorCode, message: string) {
    super(message);
    this.name = 'PipelinePackageHandoffError';
    this.code = code;
  }
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HANDOFF_KEYS = [
  'archiveDigest',
  'contractCatalogDigest',
  'packageRoot',
  'sourceInventoryDigest',
];

function failHandoff(
  code: PipelinePackageHandoffErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new PipelinePackageHandoffError(code, withCauseCode(message, cause));
}

function sha256Bytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function isContained(root: string, target: string): boolean {
  const child = path.relative(root, target);
  return (
    child.length > 0 &&
    child !== '..' &&
    !child.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(child)
  );
}

function assertHandoffInput(value: PipelinePackageHandoff): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failHandoff(
      'E_PIPELINE_HANDOFF_INVALID',
      'Pipeline package handoff must be one closed object.',
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    failHandoff('E_PIPELINE_HANDOFF_INVALID', 'Pipeline package handoff must be plain JSON data.');
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    JSON.stringify((keys as string[]).sort()) !== JSON.stringify(HANDOFF_KEYS)
  ) {
    failHandoff(
      'E_PIPELINE_HANDOFF_INVALID',
      'Pipeline package handoff must contain exactly the four frozen fields.',
    );
  }
  for (const digest of [
    value.archiveDigest,
    value.sourceInventoryDigest,
    value.contractCatalogDigest,
  ]) {
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      failHandoff('E_PIPELINE_HANDOFF_INVALID', 'Pipeline package handoff digest is invalid.');
    }
  }
  if (typeof value.packageRoot !== 'string' || !path.isAbsolute(value.packageRoot)) {
    failHandoff('E_PIPELINE_HANDOFF_INVALID', 'Pipeline package handoff root must be absolute.');
  }
}

function assertVerificationOptions(options: PipelinePackageHandoffVerificationOptions): void {
  const keys = Reflect.ownKeys(options);
  if (keys.some((key) => key !== 'archivePath')) {
    failHandoff('E_PIPELINE_HANDOFF_INVALID', 'Pipeline package verification options are invalid.');
  }
  if (
    options.archivePath !== undefined &&
    (typeof options.archivePath !== 'string' || !path.isAbsolute(options.archivePath))
  ) {
    failHandoff('E_PIPELINE_HANDOFF_INVALID', 'Pipeline package archive path must be absolute.');
  }
}

function realPackageRoot(candidate: string): string {
  const lexical = path.resolve(candidate);
  const stat = lstatSync(lexical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    failHandoff('E_PIPELINE_HANDOFF_UNSAFE', 'Pipeline package root is not a real directory.');
  }
  const root = realpathSync(lexical);
  if (root !== lexical) {
    failHandoff('E_PIPELINE_HANDOFF_UNSAFE', 'Pipeline package root traverses a symbolic link.');
  }
  return root;
}

function packageInventory(root: string): {
  digest: `sha256:${string}`;
  paths: Set<string>;
} {
  const entries: Array<{
    path: string;
    mode: number;
    size: number;
    contentDigest: `sha256:${string}`;
  }> = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        failHandoff('E_PIPELINE_HANDOFF_UNSAFE', 'Pipeline package tree contains a symbolic link.');
      }
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!stat.isFile()) {
        failHandoff(
          'E_PIPELINE_HANDOFF_UNSAFE',
          'Pipeline package tree contains a non-regular entry.',
        );
      }
      const target = realpathSync(absolute);
      if (!isContained(root, target)) {
        failHandoff('E_PIPELINE_HANDOFF_UNSAFE', 'Pipeline package entry escapes its root.');
      }
      const bytes = readFileSync(target);
      entries.push({
        path: path.relative(root, target).split(path.sep).join('/'),
        mode: (stat.mode & 0o111) === 0 ? 0o644 : 0o755,
        size: bytes.byteLength,
        contentDigest: sha256Bytes(bytes),
      });
    }
  };
  visit(root);
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    digest: sha256CanonicalJson(entries),
    paths: new Set(entries.map((entry) => entry.path)),
  };
}

function safePackageFile(root: string, relativePath: string, inventory: Set<string>): string {
  const portable = relativePath.replaceAll('\\', '/').replace(/^\.\//u, '');
  const normalized = path.posix.normalize(portable);
  if (
    !normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized) ||
    !inventory.has(normalized)
  ) {
    failHandoff(
      'E_PIPELINE_HANDOFF_UNSAFE',
      'Pipeline package asset is outside the frozen inventory.',
    );
  }
  const target = realpathSync(path.join(root, ...normalized.split('/')));
  const stat = lstatSync(target);
  if (!isContained(root, target) || !stat.isFile() || stat.isSymbolicLink()) {
    failHandoff(
      'E_PIPELINE_HANDOFF_UNSAFE',
      'Pipeline package asset is not a contained regular file.',
    );
  }
  return target;
}

function runtimeExportTarget(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = runtimeExportTarget(entry);
      if (target !== null) return target;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const conditions = value as Record<string, unknown>;
  return runtimeExportTarget(conditions.import) ?? runtimeExportTarget(conditions.default);
}

function publicExportPath(
  root: string,
  exportsField: unknown,
  subpath: string,
  inventory: Set<string>,
): string {
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline package exports are invalid.');
  }
  const exportsRecord = exportsField as Record<string, unknown>;
  let value = exportsRecord[subpath];
  let capture: string | null = null;
  if (value === undefined) {
    const matches = Object.keys(exportsRecord)
      .filter((key) => key.includes('*'))
      .flatMap((key) => {
        const star = key.indexOf('*');
        if (star !== key.lastIndexOf('*')) return [];
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) return [];
        return [{ key, capture: subpath.slice(prefix.length, subpath.length - suffix.length) }];
      })
      .sort((left, right) => right.key.length - left.key.length);
    const match = matches[0];
    if (match !== undefined) {
      value = exportsRecord[match.key];
      capture = match.capture;
    }
  }
  let target = runtimeExportTarget(value);
  if (target === null || !target.startsWith('./')) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Required pipeline public export is missing.');
  }
  if (capture !== null) target = target.replace('*', capture);
  if (target.includes('*')) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline public export is ambiguous.');
  }
  return safePackageFile(root, target, inventory);
}

function parseJsonAsset(pathname: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(pathname, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline package JSON asset is invalid.');
  }
  return parsed as Record<string, unknown>;
}

function pickNamedApis<const Names extends readonly string[]>(
  loaded: Record<string, unknown>,
  names: Names,
  functionNames: ReadonlySet<string>,
): Readonly<Record<Names[number], unknown>> {
  const picked: Record<string, unknown> = {};
  for (const name of names) {
    if (!(name in loaded) || (functionNames.has(name) && typeof loaded[name] !== 'function')) {
      failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Required pipeline public API is missing.');
    }
    picked[name] = loaded[name];
  }
  return Object.freeze(picked) as Readonly<Record<Names[number], unknown>>;
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function assertBaseEvidenceRegistry(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline base-evidence registry is invalid.');
  }
  const registry = value as Record<string, unknown>;
  if (
    registry.protocolVersion !== '2.0.0' ||
    !Array.isArray(registry.providers) ||
    !Array.isArray(registry.resolvers)
  ) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline base-evidence registry is invalid.');
  }
  const artifactProvider = registry.providers.filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).providerId ===
        'local-operate-artifact-evidence-provider' &&
      (entry as Record<string, unknown>).providerVersion === '2.0.0',
  );
  const artifactResolver = registry.resolvers.filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).resolverId ===
        'local-operate-artifact-evidence-resolver' &&
      (entry as Record<string, unknown>).resolverVersion === '2.0.0' &&
      Array.isArray((entry as Record<string, unknown>).supportedEvidenceKinds) &&
      ((entry as Record<string, unknown>).supportedEvidenceKinds as unknown[]).includes(
        'operate-artifact',
      ),
  );
  if (artifactProvider.length !== 1 || artifactResolver.length !== 1) {
    failHandoff(
      'E_PIPELINE_HANDOFF_INCOMPATIBLE',
      'Pipeline base-evidence registry lacks the canonical operate-artifact bridge.',
    );
  }
  return deepFreeze(structuredClone(registry));
}

function assertLiveEvidenceProviderMembership(providers: unknown): void {
  if (!Array.isArray(providers)) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline provider registry is invalid.');
  }
  if (providers.length === 0) return;
  const identities = providers.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline provider registry is invalid.');
    }
    const provider = entry as Record<string, unknown>;
    if (typeof provider.providerId !== 'string' || provider.providerVersion !== '1.0.0') {
      failHandoff(
        'E_PIPELINE_HANDOFF_INCOMPATIBLE',
        'Pipeline provider registry contains an unsupported identity.',
      );
    }
    return provider.providerId;
  });
  if (!sameList(identities, PACKAGE_B_LIVE_EVIDENCE_PROVIDERS)) {
    failHandoff(
      'E_PIPELINE_HANDOFF_INCOMPATIBLE',
      'Pipeline provider registry is neither Package-A nor the frozen Package-B membership.',
    );
  }
}

type ProtocolContract = {
  kind?: unknown;
  protocolVersion?: unknown;
  schema?: { properties?: { kind?: { const?: unknown } } };
};

async function verifyPipelinePackageHandoffInternal(
  handoff: PipelinePackageHandoff,
  options: PipelinePackageHandoffVerificationOptions,
): Promise<VerifiedPipelinePackageHandoff> {
  assertHandoffInput(handoff);
  assertVerificationOptions(options);
  const root = realPackageRoot(handoff.packageRoot);
  const inventory = packageInventory(root);
  if (inventory.digest !== handoff.sourceInventoryDigest) {
    failHandoff(
      'E_PIPELINE_HANDOFF_DIGEST_MISMATCH',
      'Pipeline package source inventory digest does not match.',
    );
  }

  const manifestPath = safePackageFile(root, 'package.json', inventory.paths);
  const manifest = parseJsonAsset(manifestPath);
  if (manifest.name !== 'planr-pipeline') {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline package identity is incompatible.');
  }
  const rootEntry = publicExportPath(root, manifest.exports, '.', inventory.paths);
  const protocolEntry = publicExportPath(root, manifest.exports, './protocol', inventory.paths);
  const evidenceEntry = publicExportPath(
    root,
    manifest.exports,
    './operate/evidence-v2',
    inventory.paths,
  );
  const contractCatalog = safePackageFile(
    root,
    'lib/protocol/generated/contract-catalog-v2.mjs',
    inventory.paths,
  );
  if (sha256Bytes(readFileSync(contractCatalog)) !== handoff.contractCatalogDigest) {
    failHandoff(
      'E_PIPELINE_HANDOFF_DIGEST_MISMATCH',
      'Pipeline contract catalog digest does not match.',
    );
  }

  let archiveVerification: VerifiedPipelinePackageHandoff['archiveVerification'] =
    'externally-preverified';
  if (options.archivePath !== undefined) {
    const lexicalArchive = path.resolve(options.archivePath);
    const stat = lstatSync(lexicalArchive);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      realpathSync(lexicalArchive) !== lexicalArchive
    ) {
      failHandoff('E_PIPELINE_HANDOFF_UNSAFE', 'Pipeline package archive is not a real file.');
    }
    if (sha256Bytes(readFileSync(lexicalArchive)) !== handoff.archiveDigest) {
      failHandoff(
        'E_PIPELINE_HANDOFF_DIGEST_MISMATCH',
        'Pipeline package archive digest does not match.',
      );
    }
    archiveVerification = 'verified';
  }

  let rootModule: Record<string, unknown>;
  let protocolModule: Record<string, unknown>;
  let evidenceModule: Record<string, unknown>;
  try {
    [rootModule, protocolModule, evidenceModule] = (await Promise.all([
      import(pathToFileURL(rootEntry).href),
      import(pathToFileURL(protocolEntry).href),
      import(pathToFileURL(evidenceEntry).href),
    ])) as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
  } catch (error) {
    failHandoff(
      'E_PIPELINE_HANDOFF_INCOMPATIBLE',
      'Pipeline public exports could not be loaded from verified package bytes.',
      error,
    );
  }
  const rootApi = pickNamedApis(rootModule, PIPELINE_ROOT_API_NAMES, ROOT_FUNCTION_API_NAMES);
  const protocolApi = pickNamedApis(
    protocolModule,
    PIPELINE_PROTOCOL_API_NAMES,
    new Set([
      'loadLandingContract',
      'loadOperateLiveEvidenceContract',
      'loadOperateRuntimeContract',
      'loadProtocolContract',
    ]),
  );
  const evidenceApi = pickNamedApis(evidenceModule, PIPELINE_EVIDENCE_API_NAMES, new Set<string>());
  const baseEvidenceRegistry = assertBaseEvidenceRegistry(
    evidenceApi.OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
  );
  if (
    !sameList(protocolApi.OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2, LIVE_EVIDENCE_CONTRACT_KINDS) ||
    !sameList(protocolApi.LANDING_CONTRACT_KINDS_V1, LANDING_CONTRACT_KINDS)
  ) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline contract families changed.');
  }

  const operateContractRegistry = publicExportPath(
    root,
    manifest.exports,
    './registry/operate-v2-contracts.json',
    inventory.paths,
  );
  const registry = parseJsonAsset(operateContractRegistry);
  if (!Array.isArray(registry.contracts)) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline contract registry is invalid.');
  }
  const registryRows = registry.contracts
    .map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline contract row is invalid.');
      }
      const row = value as Record<string, unknown>;
      if (
        typeof row.id !== 'string' ||
        typeof row.schemaPath !== 'string' ||
        !Number.isInteger(row.runtimeOrder)
      ) {
        failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline contract row is invalid.');
      }
      return {
        id: row.id,
        runtimeOrder: row.runtimeOrder as number,
        schemaPath: row.schemaPath,
      };
    })
    .sort((left, right) => left.runtimeOrder - right.runtimeOrder);
  if (
    new Set(registryRows.map(({ id }) => id)).size !== registryRows.length ||
    new Set(registryRows.map(({ runtimeOrder }) => runtimeOrder)).size !== registryRows.length ||
    !sameList(
      protocolApi.OPERATE_RUNTIME_CONTRACT_KINDS,
      registryRows.map(({ id }) => id),
    )
  ) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline runtime catalog is inconsistent.');
  }
  const liveRows = registryRows.filter(({ id }) =>
    (LIVE_EVIDENCE_CONTRACT_KINDS as readonly string[]).includes(id),
  );
  if (
    !sameList(
      liveRows.map(({ id }) => id),
      LIVE_EVIDENCE_CONTRACT_KINDS,
    ) ||
    liveRows.some(({ runtimeOrder }, index) => runtimeOrder !== 70 + index)
  ) {
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline live-evidence catalog changed.');
  }

  const loadLive = protocolApi.loadOperateLiveEvidenceContract as (
    kind: string,
    options: { protocolVersion: string },
  ) => ProtocolContract;
  const liveEvidenceSchemas = liveRows.map(({ id, schemaPath }) => {
    const schemaAsset = publicExportPath(
      root,
      manifest.exports,
      `./${schemaPath}`,
      inventory.paths,
    );
    const schema = parseJsonAsset(schemaAsset);
    const loaded = loadLive(id, { protocolVersion: '2.0.0' });
    if (
      loaded.kind !== id ||
      loaded.protocolVersion !== '2.0.0' ||
      loaded.schema?.properties?.kind?.const !== id ||
      (schema.properties as { kind?: { const?: unknown } } | undefined)?.kind?.const !== id
    ) {
      failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline live-evidence schema changed.');
    }
    return { kind: id, path: schemaAsset };
  });

  const loadLanding = protocolApi.loadLandingContract as (
    kind: string,
    options: { protocolVersion: string },
  ) => ProtocolContract;
  const landingSchemas = LANDING_CONTRACT_KINDS.map((kind) => {
    const schemaAsset = publicExportPath(
      root,
      manifest.exports,
      `./schemas/v1.2.0/${kind}.schema.json`,
      inventory.paths,
    );
    const loaded = loadLanding(kind, { protocolVersion: '1.2.0' });
    if (
      loaded.kind !== kind ||
      loaded.protocolVersion !== '1.2.0' ||
      loaded.schema?.properties?.kind?.const !== kind
    ) {
      failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline landing schema changed.');
    }
    return { kind, path: schemaAsset };
  });

  const liveEvidenceProviderRegistry = publicExportPath(
    root,
    manifest.exports,
    './registry/live-evidence-providers.json',
    inventory.paths,
  );
  const landingOperationRegistry = publicExportPath(
    root,
    manifest.exports,
    './registry/landing-operations.json',
    inventory.paths,
  );
  const liveRegistry = parseJsonAsset(liveEvidenceProviderRegistry);
  const landingRegistry = parseJsonAsset(landingOperationRegistry);
  assertLiveEvidenceProviderMembership(liveRegistry.providers);
  let validatedLiveRegistry: Readonly<Record<string, unknown>>;
  try {
    const validated = (
      rootApi.assertLiveEvidenceProviderRegistryV2 as (
        value: unknown,
        options: Record<string, unknown>,
      ) => unknown
    )(liveRegistry, {
      baseEvidenceProviders: baseEvidenceRegistry.providers,
      baseResolvers: baseEvidenceRegistry.resolvers,
    });
    if (!validated || typeof validated !== 'object' || Array.isArray(validated)) {
      failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline provider registry is invalid.');
    }
    validatedLiveRegistry = deepFreeze(structuredClone(validated as Record<string, unknown>));
    (rootApi.assertLandingOperationRegistry as (value: unknown) => unknown)(landingRegistry);
  } catch (error) {
    if (error instanceof PipelinePackageHandoffError) throw error;
    failHandoff('E_PIPELINE_HANDOFF_INCOMPATIBLE', 'Pipeline registry validation failed.');
  }

  return deepFreeze({
    archiveDigest: handoff.archiveDigest,
    packageRoot: root,
    sourceInventoryDigest: handoff.sourceInventoryDigest,
    contractCatalogDigest: handoff.contractCatalogDigest,
    archiveVerification,
    publicEntries: { root: rootEntry, protocol: protocolEntry, evidence: evidenceEntry },
    rootApi,
    protocolApi,
    evidenceApi,
    registryValues: {
      liveEvidenceProviderRegistry: validatedLiveRegistry,
      baseEvidenceRegistry,
    },
    assets: {
      contractCatalog,
      operateContractRegistry,
      liveEvidenceProviderRegistry,
      landingOperationRegistry,
      liveEvidenceSchemas,
      landingSchemas,
    },
  });
}

/**
 * Verify one explicit Package-A or Package-B custody handoff without consulting
 * an installed sibling, environment variable, source checkout, or legacy resolver.
 */
export async function verifyPipelinePackageHandoff(
  handoff: PipelinePackageHandoff,
  options: PipelinePackageHandoffVerificationOptions = {},
): Promise<VerifiedPipelinePackageHandoff> {
  try {
    return await verifyPipelinePackageHandoffInternal(handoff, options);
  } catch (error) {
    if (error instanceof PipelinePackageHandoffError) throw error;
    throw new PipelinePackageHandoffError(
      'E_PIPELINE_HANDOFF_UNSAFE',
      'Pipeline package handoff verification failed.',
    );
  }
}

export interface LandingPackageHandoff {
  readonly archiveDigest: `sha256:${string}`;
  readonly packageRoot: string;
  readonly sourceInventoryDigest: `sha256:${string}`;
  readonly landingManifestDigest: `sha256:${string}`;
}

export interface LandingPackageHandoffVerificationOptions {
  readonly archivePath?: string;
}

const LANDING_HANDOFF_KEYS = [
  'archiveDigest',
  'landingManifestDigest',
  'packageRoot',
  'sourceInventoryDigest',
] as const;

const LANDING_ROOT_API_NAMES = [
  'LANDING_OPERATION_REGISTRY_PATH',
  'LANDING_WORKFLOW_ASSET_PATHS',
  'LANDING_WORKFLOW_CATALOG_PATH',
  'LANDING_WORKFLOW_ID',
  'LANDING_WORKFLOW_MANIFEST_PATH',
  'advanceLanding',
  'assertCurrentShipClosureForLanding',
  'assertLandingOperationRegistry',
  'assertLandingWorkflowCatalog',
  'assertLandingWorkflowManifest',
  'bindLandingPlan',
  'createLandingOwnerRuntimeHost',
  'inspectShipClosureForLanding',
  'landingStatus',
  'prepareLanding',
  'previewLandingDocket',
  'readLandingOperationRegistry',
  'readLandingWorkflowCatalog',
  'readLandingWorkflowManifest',
  'showLanding',
] as const;

const LANDING_ROOT_FUNCTION_NAMES = new Set<string>([
  'advanceLanding',
  'assertCurrentShipClosureForLanding',
  'assertLandingOperationRegistry',
  'assertLandingWorkflowCatalog',
  'assertLandingWorkflowManifest',
  'bindLandingPlan',
  'createLandingOwnerRuntimeHost',
  'inspectShipClosureForLanding',
  'landingStatus',
  'prepareLanding',
  'previewLandingDocket',
  'readLandingOperationRegistry',
  'readLandingWorkflowCatalog',
  'readLandingWorkflowManifest',
  'showLanding',
]);

const LANDING_PRIVATE_ROOT_EXPORTS = [
  'createLandingTrustedRuntimeHost',
  'issueLandingOwnerConfirmation',
  'createLandingEvent',
  'createLandingPhaseReceipt',
  'createLandingReceipt',
] as const;

export type LandingRootApiName = (typeof LANDING_ROOT_API_NAMES)[number];

export interface VerifiedLandingPackageHandoff extends LandingPackageHandoff {
  readonly archiveVerification: 'verified' | 'externally-preverified';
  readonly publicEntry: string;
  readonly landingApi: Readonly<Record<LandingRootApiName, unknown>>;
  readonly registryValues: Readonly<{
    operationRegistry: Readonly<Record<string, unknown>>;
    workflowCatalog: Readonly<Record<string, unknown>>;
    workflowManifest: Readonly<Record<string, unknown>>;
  }>;
  readonly assets: Readonly<{
    operationRegistry: string;
    workflowCatalog: string;
    workflowManifest: string;
    workflowSchema: string;
    landingModule: string;
    landingTypes: string;
    hostAssets: readonly string[];
  }>;
}

export type LandingPackageHandoffErrorCode =
  | 'E_LANDING_HANDOFF_INVALID'
  | 'E_LANDING_HANDOFF_UNSAFE'
  | 'E_LANDING_HANDOFF_DIGEST_MISMATCH'
  | 'E_LANDING_HANDOFF_INCOMPATIBLE';

export class LandingPackageHandoffError extends Error {
  readonly code: LandingPackageHandoffErrorCode;

  constructor(code: LandingPackageHandoffErrorCode, message: string) {
    super(message);
    this.name = 'LandingPackageHandoffError';
    this.code = code;
  }
}

function failLandingHandoff(
  code: LandingPackageHandoffErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new LandingPackageHandoffError(code, withCauseCode(message, cause));
}

function assertLandingHandoffInput(value: LandingPackageHandoff): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failLandingHandoff('E_LANDING_HANDOFF_INVALID', 'Landing package handoff is invalid.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    failLandingHandoff('E_LANDING_HANDOFF_INVALID', 'Landing package handoff must be plain data.');
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    JSON.stringify((keys as string[]).sort()) !== JSON.stringify(LANDING_HANDOFF_KEYS)
  ) {
    failLandingHandoff(
      'E_LANDING_HANDOFF_INVALID',
      'Landing package handoff must contain exactly the four frozen fields.',
    );
  }
  for (const digest of [
    value.archiveDigest,
    value.sourceInventoryDigest,
    value.landingManifestDigest,
  ]) {
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      failLandingHandoff('E_LANDING_HANDOFF_INVALID', 'Landing handoff digest is invalid.');
    }
  }
  if (typeof value.packageRoot !== 'string' || !path.isAbsolute(value.packageRoot)) {
    failLandingHandoff('E_LANDING_HANDOFF_INVALID', 'Landing package root must be absolute.');
  }
}

function assertLandingVerificationOptions(options: LandingPackageHandoffVerificationOptions): void {
  const keys = Reflect.ownKeys(options);
  if (keys.some((key) => key !== 'archivePath')) {
    failLandingHandoff('E_LANDING_HANDOFF_INVALID', 'Landing verification options are invalid.');
  }
  if (
    options.archivePath !== undefined &&
    (typeof options.archivePath !== 'string' || !path.isAbsolute(options.archivePath))
  ) {
    failLandingHandoff('E_LANDING_HANDOFF_INVALID', 'Landing archive path must be absolute.');
  }
}

function assertExactLandingWorkflow(catalog: Readonly<Record<string, unknown>>): void {
  const workflow = catalog.workflow as Record<string, unknown> | undefined;
  const commands = workflow?.commands as Record<string, unknown>[] | undefined;
  const hostAssets = workflow?.hostAssets as Record<string, unknown>[] | undefined;
  if (
    catalog.kind !== 'landing-workflow-catalog' ||
    catalog.schemaVersion !== '1.0.0' ||
    catalog.protocolVersion !== '1.2.0' ||
    catalog.authority !== 'none' ||
    workflow?.workflowId !== 'planr-land' ||
    workflow.authorityBoundary !== 'portable-json-is-not-effect-authority' ||
    !Array.isArray(commands) ||
    !Array.isArray(hostAssets)
  ) {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing workflow catalog changed.');
  }
  const commandTruth = commands.map(
    ({ id, access, effect, agentCallable, machineJson, requiresTty }) => ({
      id,
      access,
      effect,
      agentCallable,
      machineJson,
      requiresTty,
    }),
  );
  const expectedCommandTruth = [
    {
      id: 'prepare',
      access: 'read-only',
      effect: 'none',
      agentCallable: true,
      machineJson: true,
      requiresTty: false,
    },
    {
      id: 'show',
      access: 'read-only',
      effect: 'none',
      agentCallable: true,
      machineJson: true,
      requiresTty: false,
    },
    {
      id: 'status',
      access: 'read-only',
      effect: 'none',
      agentCallable: true,
      machineJson: true,
      requiresTty: false,
    },
    {
      id: 'advance',
      access: 'owner-interactive',
      effect: 'runtime-dispatch',
      agentCallable: false,
      machineJson: false,
      requiresTty: true,
    },
  ];
  const exactHosts = [
    'skills/planr-land/SKILL.md',
    'adapters/codex/skills/planr-land/SKILL.md',
    'adapters/cursor/rules/openplanr-land.mdc',
  ];
  if (
    JSON.stringify(commandTruth) !== JSON.stringify(expectedCommandTruth) ||
    JSON.stringify(hostAssets.map(({ path: assetPath }) => assetPath)) !==
      JSON.stringify(exactHosts)
  ) {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing workflow authority changed.');
  }
}

async function verifyLandingPackageHandoffInternal(
  handoff: LandingPackageHandoff,
  options: LandingPackageHandoffVerificationOptions,
): Promise<VerifiedLandingPackageHandoff> {
  assertLandingHandoffInput(handoff);
  assertLandingVerificationOptions(options);
  const root = realPackageRoot(handoff.packageRoot);
  const inventory = packageInventory(root);
  if (inventory.digest !== handoff.sourceInventoryDigest) {
    failLandingHandoff(
      'E_LANDING_HANDOFF_DIGEST_MISMATCH',
      'Landing package source inventory digest does not match.',
    );
  }
  const packageManifest = parseJsonAsset(safePackageFile(root, 'package.json', inventory.paths));
  if (packageManifest.name !== 'planr-pipeline') {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing package identity changed.');
  }
  const workflowManifest = safePackageFile(
    root,
    'conformance/fixtures/landing-workflow/generated-assets.json',
    inventory.paths,
  );
  if (sha256Bytes(readFileSync(workflowManifest)) !== handoff.landingManifestDigest) {
    failLandingHandoff(
      'E_LANDING_HANDOFF_DIGEST_MISMATCH',
      'Landing workflow manifest digest does not match.',
    );
  }
  const publicEntry = publicExportPath(root, packageManifest.exports, '.', inventory.paths);
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(publicEntry).href)) as Record<string, unknown>;
  } catch (error) {
    failLandingHandoff(
      'E_LANDING_HANDOFF_INCOMPATIBLE',
      'Landing public API is unavailable.',
      error,
    );
  }
  for (const name of LANDING_PRIVATE_ROOT_EXPORTS) {
    if (Object.hasOwn(loaded, name)) {
      failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing private authority escaped.');
    }
  }
  const landingApi = pickNamedApis(loaded, LANDING_ROOT_API_NAMES, LANDING_ROOT_FUNCTION_NAMES);
  if (
    landingApi.LANDING_WORKFLOW_ID !== 'planr-land' ||
    landingApi.LANDING_WORKFLOW_CATALOG_PATH !== 'registry/landing-workflows.json' ||
    landingApi.LANDING_OPERATION_REGISTRY_PATH !== 'registry/landing-operations.json' ||
    landingApi.LANDING_WORKFLOW_MANIFEST_PATH !==
      'conformance/fixtures/landing-workflow/generated-assets.json' ||
    !Array.isArray(landingApi.LANDING_WORKFLOW_ASSET_PATHS)
  ) {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing public identity changed.');
  }
  const workflowAssetPaths = landingApi.LANDING_WORKFLOW_ASSET_PATHS as readonly string[];
  const workflowCatalog = safePackageFile(root, 'registry/landing-workflows.json', inventory.paths);
  const operationRegistry = safePackageFile(
    root,
    'registry/landing-operations.json',
    inventory.paths,
  );
  const workflowSchema = safePackageFile(
    root,
    'schemas/v1.2.0/landing-workflow-catalog.schema.json',
    inventory.paths,
  );
  const catalogValue = parseJsonAsset(workflowCatalog);
  const operationValue = parseJsonAsset(operationRegistry);
  const manifestValue = parseJsonAsset(workflowManifest);
  let validatedCatalog: Readonly<Record<string, unknown>>;
  let validatedRegistry: Readonly<Record<string, unknown>>;
  let validatedManifest: Readonly<Record<string, unknown>>;
  try {
    validatedCatalog = (
      landingApi.assertLandingWorkflowCatalog as (
        value: unknown,
      ) => Readonly<Record<string, unknown>>
    )(catalogValue);
    validatedRegistry = (
      landingApi.assertLandingOperationRegistry as (
        value: unknown,
      ) => Readonly<Record<string, unknown>>
    )(operationValue);
    validatedManifest = (
      landingApi.assertLandingWorkflowManifest as (
        value: unknown,
        options?: { verifyFiles?: boolean },
      ) => Readonly<Record<string, unknown>>
    )(manifestValue, { verifyFiles: false });
  } catch (error) {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing assets are invalid.', error);
  }
  assertExactLandingWorkflow(validatedCatalog);
  const manifestAssets = validatedManifest.assets as Record<string, unknown>[];
  if (
    !Array.isArray(manifestAssets) ||
    JSON.stringify(manifestAssets.map(({ path: assetPath }) => assetPath)) !==
      JSON.stringify(workflowAssetPaths)
  ) {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing asset membership changed.');
  }
  for (const asset of manifestAssets) {
    if (
      typeof asset.path !== 'string' ||
      typeof asset.digest !== 'string' ||
      sha256Bytes(readFileSync(safePackageFile(root, asset.path, inventory.paths))) !== asset.digest
    ) {
      failLandingHandoff('E_LANDING_HANDOFF_DIGEST_MISMATCH', 'Landing asset digest changed.');
    }
  }
  const readCatalog = (
    landingApi.readLandingWorkflowCatalog as () => Readonly<Record<string, unknown>>
  )();
  const readRegistry = (
    landingApi.readLandingOperationRegistry as () => Readonly<Record<string, unknown>>
  )();
  const readManifest = (
    landingApi.readLandingWorkflowManifest as (options?: {
      verifyFiles?: boolean;
    }) => Readonly<Record<string, unknown>>
  )({ verifyFiles: false });
  if (
    sha256CanonicalJson(readCatalog) !== sha256CanonicalJson(validatedCatalog) ||
    sha256CanonicalJson(readRegistry) !== sha256CanonicalJson(validatedRegistry) ||
    sha256CanonicalJson(readManifest) !== sha256CanonicalJson(validatedManifest)
  ) {
    failLandingHandoff('E_LANDING_HANDOFF_INCOMPATIBLE', 'Landing public readers changed.');
  }
  let archiveVerification: VerifiedLandingPackageHandoff['archiveVerification'] =
    'externally-preverified';
  if (options.archivePath !== undefined) {
    const archive = path.resolve(options.archivePath);
    const stat = lstatSync(archive);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(archive) !== archive) {
      failLandingHandoff('E_LANDING_HANDOFF_UNSAFE', 'Landing archive is not a real file.');
    }
    if (sha256Bytes(readFileSync(archive)) !== handoff.archiveDigest) {
      failLandingHandoff('E_LANDING_HANDOFF_DIGEST_MISMATCH', 'Landing archive digest changed.');
    }
    archiveVerification = 'verified';
  }
  // Protocol 1.2 keeps the historical host-asset references readable, but the
  // public pipeline tarball is deliberately prompt-free under Protocol 1.8.
  // Host-native Plan/Land skills are distributed by their owning plugin.
  const hostAssets: string[] = [];
  return deepFreeze({
    archiveDigest: handoff.archiveDigest,
    packageRoot: root,
    sourceInventoryDigest: handoff.sourceInventoryDigest,
    landingManifestDigest: handoff.landingManifestDigest,
    archiveVerification,
    publicEntry,
    landingApi,
    registryValues: {
      operationRegistry: structuredClone(validatedRegistry),
      workflowCatalog: structuredClone(validatedCatalog),
      workflowManifest: structuredClone(validatedManifest),
    },
    assets: {
      operationRegistry,
      workflowCatalog,
      workflowManifest,
      workflowSchema,
      landingModule: safePackageFile(root, 'lib/pipeline/landing.mjs', inventory.paths),
      landingTypes: safePackageFile(root, 'lib/pipeline/landing.d.mts', inventory.paths),
      hostAssets,
    },
  });
}

/** Verify one explicit, content-bound landing Package-B handoff. */
export async function verifyLandingPackageHandoff(
  handoff: LandingPackageHandoff,
  options: LandingPackageHandoffVerificationOptions = {},
): Promise<VerifiedLandingPackageHandoff> {
  try {
    return await verifyLandingPackageHandoffInternal(handoff, options);
  } catch (error) {
    if (error instanceof LandingPackageHandoffError) throw error;
    if (error instanceof PipelinePackageHandoffError) {
      const code = error.code.replace(
        'E_PIPELINE_',
        'E_LANDING_',
      ) as LandingPackageHandoffErrorCode;
      throw new LandingPackageHandoffError(code, error.message);
    }
    throw new LandingPackageHandoffError(
      'E_LANDING_HANDOFF_UNSAFE',
      'Landing package handoff verification failed.',
    );
  }
}

export interface GuidedInteractionValidators {
  createGuidedAnswerSubmission(value: unknown): unknown;
  validateGuidedQuestion(value: unknown): unknown[];
  validateGuidedQuestionnaire(value: unknown): unknown[];
  validateGuidedAnswerEnvelope(value: unknown): unknown[];
  validateGuidedSession(value: unknown): unknown[];
  validateGuidedConfirmation(value: unknown): unknown[];
  validateStructuredAction(value: unknown): unknown[];
  validateEvidenceDiagnostic(value: unknown): unknown[];
}

function candidateRoots(): string[] {
  const roots: string[] = [];

  try {
    const packageManifest = require.resolve('planr-pipeline/package.json');
    roots.push(path.dirname(packageManifest));
  } catch {
    // Optional dependency may be omitted by the minimal installer.
  }
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function resolvePipelinePackage(required = true): PipelinePackage | null {
  for (const root of candidateRoots()) {
    const packagePath = path.join(root, 'package.json');
    const binPath = path.join(root, 'bin', 'planr-pipeline.mjs');
    const adapterRegistryPath = path.join(root, 'registry', 'adapters.json');
    const roleRegistryPath = path.join(root, 'registry', 'roles.json');
    if (![packagePath, binPath, adapterRegistryPath, roleRegistryPath].every(existsSync)) continue;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return {
      root,
      version: pkg.version ?? '0.0.0',
      binPath,
      adapterRegistryPath,
      roleRegistryPath,
    };
  }

  if (!required) return null;
  const error = new Error(
    'The pipeline package is not installed. Run `npm install -g openplanr@latest` or rerun setup without `--minimal`.',
  );
  error.name = 'E_PIPELINE_NOT_INSTALLED';
  throw error;
}

/**
 * Resolve the additive Protocol v1.2 guided-interaction validators without
 * making OpenPlanr depend on private pipeline source paths at compile time.
 */
export async function resolveGuidedInteractionValidators(): Promise<GuidedInteractionValidators> {
  const candidates = candidateRoots()
    .map((root) => {
      const packagePath = path.join(root, 'package.json');
      if (!existsSync(packagePath)) return null;
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
      return { root, version: pkg.version ?? '0.0.0' };
    })
    .filter((candidate): candidate is { root: string; version: string } => candidate !== null);
  if (candidates.length === 0) {
    const error = new Error('The pipeline package is not installed.');
    error.name = 'E_PIPELINE_NOT_INSTALLED';
    throw error;
  }
  for (const candidate of candidates) {
    const modulePath = path.join(candidate.root, 'lib', 'pipeline', 'index.mjs');
    if (!existsSync(modulePath)) continue;
    try {
      const loaded = (await import(
        pathToFileURL(modulePath).href
      )) as Partial<GuidedInteractionValidators>;
      if (
        typeof loaded.createGuidedAnswerSubmission === 'function' &&
        typeof loaded.validateGuidedQuestion === 'function' &&
        typeof loaded.validateGuidedQuestionnaire === 'function' &&
        typeof loaded.validateGuidedAnswerEnvelope === 'function' &&
        typeof loaded.validateGuidedSession === 'function' &&
        typeof loaded.validateGuidedConfirmation === 'function' &&
        typeof loaded.validateStructuredAction === 'function' &&
        typeof loaded.validateEvidenceDiagnostic === 'function'
      ) {
        return loaded as GuidedInteractionValidators;
      }
    } catch {
      // Continue to the next installed or explicitly configured candidate.
    }
  }
  const versions = [...new Set(candidates.map((candidate) => candidate.version))].join(', ');
  const error = new Error(
    `Installed planr-pipeline version(s) ${versions} do not provide the Protocol v1.2 guided interaction validators. Install the compatible full package with \`npm install -g openplanr@latest\`.`,
  );
  error.name = 'E_PIPELINE_VERSION_INCOMPATIBLE';
  throw error;
}
