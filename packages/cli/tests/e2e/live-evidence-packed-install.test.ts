// @vitest-environment node

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256CanonicalJson } from '../../src/services/canonical-json.js';
import {
  type PipelinePackageHandoff,
  type PipelinePackageHandoffErrorCode,
  verifyPipelinePackageHandoff,
} from '../../src/services/pipeline-package-service.js';
import { installPackedPipeline, type PackedPipelineInstall } from './helpers/installed-pipeline.js';

const LIVE_KINDS = [
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
];

const ROOT_APIS = [
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
];

const PROTOCOL_APIS = [
  'LANDING_CONTRACT_KINDS_V1',
  'OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2',
  'OPERATE_RUNTIME_CONTRACT_KINDS',
  'loadLandingContract',
  'loadOperateLiveEvidenceContract',
  'loadOperateRuntimeContract',
  'loadProtocolContract',
];

const EVIDENCE_APIS = ['OPEN_REFERENCE_EVIDENCE_REGISTRY_V2'];

const PACKAGE_B_PROVIDER_IDS = [
  'business-metrics',
  'deployment-health',
  'github-delivery',
  'linear-jira-work',
  'posthog-product',
  'sentry-error',
];

type PackageCandidate = Readonly<{
  archivePath: string;
  handoff: PipelinePackageHandoff;
  cleanup(): void;
}>;

let installed: PackedPipelineInstall | null = null;
let candidate: PackageCandidate;
let poisonRoot: string;
let poisonMarker: string;
const testRequire = createRequire(import.meta.url);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const originalPipelineRoot = process.env.OPENPLANR_PIPELINE_ROOT;
const originalPipelineSource = process.env.OPENPLANR_PIPELINE_SOURCE;

function environmentCandidate(): PackageCandidate | null {
  const serialized = process.env.OPENPLANR_PIPELINE_PACKAGE_A_HANDOFF;
  const archivePath = process.env.OPENPLANR_PIPELINE_PACKAGE_A_ARCHIVE;
  if (serialized === undefined && archivePath === undefined) return null;
  if (serialized === undefined || archivePath === undefined) {
    throw new Error('Package-A environment requires both handoff and archive custody.');
  }
  return {
    archivePath,
    handoff: JSON.parse(serialized) as PipelinePackageHandoff,
    cleanup: () => undefined,
  };
}

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected one JSON record.');
  }
  return value as Record<string, unknown>;
}

function assertBaseRecordsResolve(
  liveRegistry: Record<string, unknown>,
  baseRegistry: Record<string, unknown>,
): void {
  const providers = liveRegistry.providers as unknown[];
  const baseProviders = baseRegistry.providers as unknown[];
  const baseResolvers = baseRegistry.resolvers as unknown[];
  for (const value of providers) {
    const registration = record(value);
    const providerRef = record(registration.baseEvidenceProvider);
    const resolverRef = record(registration.baseResolver);
    const baseProvider = baseProviders.find((candidate) => {
      const candidateRecord = record(candidate);
      return (
        candidateRecord.providerId === providerRef.providerId &&
        candidateRecord.providerVersion === providerRef.providerVersion
      );
    });
    const baseResolver = baseResolvers.find((candidate) => {
      const candidateRecord = record(candidate);
      return (
        candidateRecord.resolverId === resolverRef.resolverId &&
        candidateRecord.resolverVersion === resolverRef.resolverVersion
      );
    });
    expect(baseProvider).toBeDefined();
    expect(baseResolver).toBeDefined();
    expect(sha256CanonicalJson(baseProvider)).toBe(providerRef.recordDigest);
    expect(sha256CanonicalJson(baseResolver)).toBe(resolverRef.recordDigest);
    expect(record(baseResolver).supportedEvidenceKinds).toContain('operate-artifact');
  }
}

function verifyInIsolatedConsumer(candidate: PackageCandidate): string {
  const isolatedRoot = join(poisonRoot, 'isolated-openplanr');
  const isolatedServices = join(isolatedRoot, 'src', 'services');
  mkdirSync(isolatedServices, { recursive: true });
  writeFileSync(join(isolatedRoot, 'package.json'), '{"private":true,"type":"module"}\n');
  copyFileSync(
    join(repositoryRoot, 'src', 'services', 'canonical-json.ts'),
    join(isolatedServices, 'canonical-json.ts'),
  );
  copyFileSync(
    join(repositoryRoot, 'src', 'services', 'pipeline-package-service.ts'),
    join(isolatedServices, 'pipeline-package-service.ts'),
  );
  const runner = join(isolatedRoot, 'verify.ts');
  writeFileSync(
    runner,
    [
      "import { verifyPipelinePackageHandoff } from './src/services/pipeline-package-service.ts';",
      "const handoff = JSON.parse(process.env.OPENPLANR_ISOLATED_HANDOFF ?? 'null');",
      'const archivePath = process.env.OPENPLANR_ISOLATED_ARCHIVE;',
      "if (!archivePath) throw new Error('Missing isolated archive custody.');",
      'const verified = await verifyPipelinePackageHandoff(handoff, { archivePath });',
      "if (verified.packageRoot !== handoff.packageRoot) throw new Error('Explicit root changed.');",
      "process.stdout.write('verified\\n');",
      '',
    ].join('\n'),
  );
  return execFileSync(process.execPath, ['--import', testRequire.resolve('tsx'), runner], {
    cwd: isolatedRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPLANR_ISOLATED_ARCHIVE: candidate.archivePath,
      OPENPLANR_ISOLATED_HANDOFF: JSON.stringify(candidate.handoff),
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function expectPathlessFailure(
  promise: Promise<unknown>,
  code: PipelinePackageHandoffErrorCode,
  forbiddenPath: string,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected strict handoff verification to fail.');
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect((error as Error).message).not.toContain(forbiddenPath);
  }
}

beforeAll(async () => {
  const environment = environmentCandidate();
  if (environment === null) {
    installed = await installPackedPipeline();
    candidate = installed;
  } else {
    candidate = environment;
  }

  poisonRoot = mkdtempSync(join(tmpdir(), 'openplanr-poison-pipeline-'));
  poisonMarker = join(poisonRoot, 'imported.marker');
  const poisonPackage = join(poisonRoot, 'node_modules', 'planr-pipeline');
  mkdirSync(join(poisonPackage, 'lib'), { recursive: true });
  mkdirSync(join(poisonPackage, 'bin'), { recursive: true });
  mkdirSync(join(poisonPackage, 'registry'), { recursive: true });
  writeFileSync(
    join(poisonPackage, 'package.json'),
    JSON.stringify({
      name: 'planr-pipeline',
      type: 'module',
      exports: {
        '.': './lib/index.mjs',
        './package.json': './package.json',
        './protocol': './lib/protocol.mjs',
      },
    }),
  );
  const poisonSource =
    "import { writeFileSync } from 'node:fs';\n" +
    `writeFileSync(${JSON.stringify(poisonMarker)}, 'ambient fallback used');\n` +
    "throw new Error('poison pipeline imported');\n";
  writeFileSync(join(poisonPackage, 'lib', 'index.mjs'), poisonSource);
  writeFileSync(join(poisonPackage, 'lib', 'protocol.mjs'), poisonSource);
  writeFileSync(join(poisonPackage, 'bin', 'planr-pipeline.mjs'), poisonSource);
  writeFileSync(join(poisonPackage, 'registry', 'adapters.json'), '{"adapters":[]}\n');
  writeFileSync(join(poisonPackage, 'registry', 'roles.json'), '{"roles":[]}\n');
  process.env.OPENPLANR_PIPELINE_ROOT = poisonPackage;
  process.env.OPENPLANR_PIPELINE_SOURCE = poisonPackage;
}, 180_000);

afterAll(() => {
  installed?.cleanup();
  rmSync(poisonRoot, { recursive: true, force: true });
  if (originalPipelineRoot === undefined) delete process.env.OPENPLANR_PIPELINE_ROOT;
  else process.env.OPENPLANR_PIPELINE_ROOT = originalPipelineRoot;
  if (originalPipelineSource === undefined) delete process.env.OPENPLANR_PIPELINE_SOURCE;
  else process.env.OPENPLANR_PIPELINE_SOURCE = originalPipelineSource;
});

describe('strict Package-A/Package-B live-evidence install', () => {
  it('accepts only the explicit regular-file root and freezes named public APIs and assets', async () => {
    const verified = await verifyPipelinePackageHandoff(candidate.handoff, {
      archivePath: candidate.archivePath,
    });
    const root = realpathSync(candidate.handoff.packageRoot);

    expect(verified.archiveVerification).toBe('verified');
    expect(verified.packageRoot).toBe(root);
    expect(verified.archiveDigest).toBe(candidate.handoff.archiveDigest);
    expect(verified.sourceInventoryDigest).toBe(candidate.handoff.sourceInventoryDigest);
    expect(verified.contractCatalogDigest).toBe(candidate.handoff.contractCatalogDigest);
    expect(Object.keys(verified.rootApi)).toEqual(ROOT_APIS);
    expect(Object.keys(verified.protocolApi)).toEqual(PROTOCOL_APIS);
    expect(Object.keys(verified.evidenceApi)).toEqual(EVIDENCE_APIS);
    expect(verified.protocolApi.OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2).toEqual(LIVE_KINDS);
    expect(verified.assets.liveEvidenceSchemas.map(({ kind }) => kind)).toEqual(LIVE_KINDS);
    expect(verified.assets.liveEvidenceSchemas).toHaveLength(11);
    expect(verified.assets.landingSchemas).toHaveLength(6);

    for (const target of [
      verified.publicEntries.root,
      verified.publicEntries.protocol,
      verified.publicEntries.evidence,
      verified.assets.contractCatalog,
      verified.assets.operateContractRegistry,
      verified.assets.liveEvidenceProviderRegistry,
      verified.assets.landingOperationRegistry,
      ...verified.assets.liveEvidenceSchemas.map(({ path }) => path),
      ...verified.assets.landingSchemas.map(({ path }) => path),
    ]) {
      expect(inside(root, realpathSync(target)), target).toBe(true);
      expect(lstatSync(target).isFile(), target).toBe(true);
      expect(lstatSync(target).isSymbolicLink(), target).toBe(false);
    }

    const liveRegistry = record(verified.registryValues.liveEvidenceProviderRegistry);
    const baseRegistry = record(verified.registryValues.baseEvidenceRegistry);
    const liveRegistryAsset = JSON.parse(
      readFileSync(verified.assets.liveEvidenceProviderRegistry, 'utf8'),
    ) as { providers: unknown[] };
    const landingRegistry = JSON.parse(
      readFileSync(verified.assets.landingOperationRegistry, 'utf8'),
    ) as { operations: unknown[] };
    expect(liveRegistry).toEqual(liveRegistryAsset);
    expect(liveRegistry).not.toBe(liveRegistryAsset);
    const providerIds = (liveRegistry.providers as unknown[]).map(
      (provider) => record(provider).providerId,
    );
    expect(providerIds.length === 0 || providerIds.length === 6).toBe(true);
    if (providerIds.length !== 0) expect(providerIds).toEqual(PACKAGE_B_PROVIDER_IDS);
    assertBaseRecordsResolve(liveRegistry, baseRegistry);
    expect(landingRegistry.operations).toHaveLength(10);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.rootApi)).toBe(true);
    expect(Object.isFrozen(verified.protocolApi)).toBe(true);
    expect(Object.isFrozen(verified.evidenceApi)).toBe(true);
    expect(Object.isFrozen(verified.registryValues)).toBe(true);
    expect(Object.isFrozen(verified.registryValues.liveEvidenceProviderRegistry)).toBe(true);
    expect(Object.isFrozen(verified.registryValues.baseEvidenceRegistry)).toBe(true);
    expect(Object.isFrozen(verified.assets.liveEvidenceSchemas)).toBe(true);
    expect(existsSync(poisonMarker)).toBe(false);
  });

  it('loads the explicit package in an isolated consumer where poison is the only ambient package', () => {
    expect(verifyInIsolatedConsumer(candidate).trim()).toBe('verified');
    expect(existsSync(poisonMarker)).toBe(false);
  });

  it('labels omitted archive bytes as externally preverified without ambient discovery', async () => {
    const verified = await verifyPipelinePackageHandoff(candidate.handoff);
    expect(verified.archiveVerification).toBe('externally-preverified');
    expect(verified.publicEntries.root.startsWith(`${verified.packageRoot}${sep}`)).toBe(true);
    expect(verified.publicEntries.protocol.startsWith(`${verified.packageRoot}${sep}`)).toBe(true);
    expect(existsSync(poisonMarker)).toBe(false);

    const closedHostile = {
      ...candidate.handoff,
      ambientFallback: poisonRoot,
    } as unknown as PipelinePackageHandoff;
    await expectPathlessFailure(
      verifyPipelinePackageHandoff(closedHostile),
      'E_PIPELINE_HANDOFF_INVALID',
      poisonRoot,
    );

    const missingRoot = join(poisonRoot, 'missing-explicit-root');
    await expectPathlessFailure(
      verifyPipelinePackageHandoff({ ...candidate.handoff, packageRoot: missingRoot }),
      'E_PIPELINE_HANDOFF_UNSAFE',
      missingRoot,
    );
    expect(existsSync(poisonMarker)).toBe(false);
  });

  it('rejects archive, inventory, catalog, and symlink substitution with typed pathless errors', async () => {
    const otherDigest = `sha256:${'0'.repeat(64)}` as const;
    await expectPathlessFailure(
      verifyPipelinePackageHandoff(
        { ...candidate.handoff, archiveDigest: otherDigest },
        { archivePath: candidate.archivePath },
      ),
      'E_PIPELINE_HANDOFF_DIGEST_MISMATCH',
      candidate.archivePath,
    );
    await expectPathlessFailure(
      verifyPipelinePackageHandoff({ ...candidate.handoff, sourceInventoryDigest: otherDigest }),
      'E_PIPELINE_HANDOFF_DIGEST_MISMATCH',
      candidate.handoff.packageRoot,
    );
    await expectPathlessFailure(
      verifyPipelinePackageHandoff({ ...candidate.handoff, contractCatalogDigest: otherDigest }),
      'E_PIPELINE_HANDOFF_DIGEST_MISMATCH',
      candidate.handoff.packageRoot,
    );

    const linkedRoot = join(poisonRoot, 'linked-package-root');
    symlinkSync(candidate.handoff.packageRoot, linkedRoot, 'dir');
    await expectPathlessFailure(
      verifyPipelinePackageHandoff({ ...candidate.handoff, packageRoot: linkedRoot }),
      'E_PIPELINE_HANDOFF_UNSAFE',
      linkedRoot,
    );

    const linkedTree = join(poisonRoot, 'linked-package-tree');
    mkdirSync(linkedTree);
    symlinkSync(
      join(candidate.handoff.packageRoot, 'package.json'),
      join(linkedTree, 'package.json'),
    );
    await expectPathlessFailure(
      verifyPipelinePackageHandoff({ ...candidate.handoff, packageRoot: linkedTree }),
      'E_PIPELINE_HANDOFF_UNSAFE',
      linkedTree,
    );
    expect(existsSync(poisonMarker)).toBe(false);
  });
});
