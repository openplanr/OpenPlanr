import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingServiceV1 } from '../../src/services/landing/landing-service.js';
import type { LandingOperationAdapterV1 } from '../../src/services/landing/operation-registry.js';
import { LandingReceiptCustodyV1 } from '../../src/services/landing/receipt-custody.js';
import type { VerifiedLandingPackageHandoff } from '../../src/services/pipeline-package-service.js';

const hash = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;
const planId = `land_${'1'.repeat(32)}`;
const operationId = `lop_${'2'.repeat(32)}`;
const receiptHash = hash('3');
const targetHash = hash('4');
const registrationHash = hash('5');
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function operation() {
  return {
    operationId,
    registryOperationId: 'commit',
    registrationHash,
    kind: 'commit',
    repositoryKey: 'project',
    dependsOn: [],
    effectClass: 'project-write',
    recoveryClass: 'reversible',
    targetBeforeHash: targetHash,
    inputDigest: hash('6'),
    outputContract: { schemaId: 'landing-phase-receipt', schemaVersion: '1.0.0' },
    preconditionHashes: [],
    timeoutMs: 30_000,
    retryPolicy: 'reconcile-before-retry',
    executorRegistration: {},
    operateBindings: [],
    containment: null,
  };
}

function fakeHandoff(spies: {
  host: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
}): VerifiedLandingPackageHandoff {
  const registry = {
    kind: 'landing-operation-registry',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    operations: [
      {
        operationId: 'commit',
        operationVersion: '1.0.0',
        kind: 'commit',
        effectClass: 'project-write',
        recoveryClass: 'reversible',
        runtimeAdapterRequired: true,
        portableAuthority: 'none',
        registrationHash,
      },
    ],
  };
  const api = {
    inspectShipClosureForLanding: spies.inspect.mockReturnValue({
      ok: true,
      feature: 'landing-test',
      receiptHash,
    }),
    prepareLanding: spies.prepare.mockImplementation((input: Record<string, unknown>) => ({
      kind: 'landing-plan',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      planId,
      authority: 'none',
      shipClosure: { receiptHash },
      feature: 'landing-test',
      candidateDigest: hash('7'),
      candidateInventoryDigest: hash('8'),
      repositories: [
        {
          repositoryKey: 'project',
          head: '9'.repeat(40),
          baselineDigest: hash('a'),
          inventoryDigest: hash('b'),
          projectionDigest: hash('c'),
        },
      ],
      currentTargetHash: input.currentTargetHash,
      operations: input.operations,
      preconditions: input.preconditions,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      planHash: hash('d'),
    })),
    bindLandingPlan: ({ plan }: { plan: Record<string, unknown> }) => plan,
    landingStatus: ({ plan, events }: Record<string, unknown>) => ({
      ok: true,
      operation: 'landing.status',
      authority: 'none',
      planId: (plan as Record<string, unknown>).planId,
      state: (events as unknown[]).length === 0 ? 'planned' : 'completed',
      readyOperationIds: [operationId],
      nextAction: 'ownerActionRequired',
    }),
    showLanding: ({ plan }: { plan: Record<string, unknown> }) => ({
      ok: true,
      operation: 'landing.show',
      authority: 'none',
      planId: plan.planId,
      effects: [],
      nextAction: 'ownerActionRequired',
    }),
    createLandingOwnerRuntimeHost: spies.host,
    advanceLanding: vi.fn(),
  };
  return {
    archiveDigest: hash('e'),
    packageRoot: '/verified/package',
    sourceInventoryDigest: hash('f'),
    landingManifestDigest: hash('1'),
    archiveVerification: 'verified',
    publicEntry: '/verified/package/lib/pipeline/index.mjs',
    landingApi: api,
    registryValues: {
      operationRegistry: registry,
      workflowCatalog: {},
      workflowManifest: {},
    },
    assets: {
      operationRegistry: '',
      workflowCatalog: '',
      workflowManifest: '',
      workflowSchema: '',
      landingModule: '',
      landingTypes: '',
      hostAssets: [],
    },
  } as unknown as VerifiedLandingPackageHandoff;
}

function fixture() {
  const projectDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'openplanr-landing-service-')));
  roots.push(projectDir);
  const host = vi.fn();
  const prepare = vi.fn();
  const inspect = vi.fn();
  const dispatch = vi.fn();
  const adapter: LandingOperationAdapterV1 = {
    adapterId: 'disposable-commit',
    operationId: 'commit',
    operationVersion: '1.0.0',
    registrationHash,
    inspectTarget: vi.fn(async () => ({ targetStateHash: targetHash })),
    dispatch,
    reconcile: vi.fn(),
  };
  const service = new LandingServiceV1({
    projectDir,
    handoff: fakeHandoff({ host, prepare, inspect }),
    adapters: [adapter],
  });
  return { projectDir, service, adapter, host, prepare, inspect, dispatch };
}

describe('LandingServiceV1', () => {
  it('prepares, shows, and reads status without effects in separate landing custody', async () => {
    const current = fixture();
    const prepared = await current.service.prepare({
      feature: 'landing-test',
      receiptHash,
      operations: [operation()],
      createdAt: '2026-08-25T10:00:00.000Z',
      expiresAt: '2026-08-25T11:00:00.000Z',
    });

    expect(prepared).toMatchObject({
      ok: true,
      operation: 'landing.prepare',
      authority: 'none',
      effects: [],
      ownerActionRequired: true,
    });
    await expect(current.service.show(planId)).resolves.toMatchObject({
      operation: 'landing.show',
      authority: 'none',
      effects: [],
    });
    await expect(current.service.status(planId)).resolves.toMatchObject({
      operation: 'landing.status',
      state: 'planned',
    });
    expect(current.prepare).toHaveBeenCalledOnce();
    expect(current.inspect).toHaveBeenCalledTimes(4);
    expect(current.dispatch).not.toHaveBeenCalled();
    expect(current.host).not.toHaveBeenCalled();
    expect(existsSync(path.join(current.projectDir, '.planr', 'landing'))).toBe(true);
    expect(existsSync(path.join(current.projectDir, '.planr', 'operate'))).toBe(false);
  });

  it.each([
    { ownerInteractive: false },
    { ownerInteractive: true, json: true },
    { ownerInteractive: true, yes: true },
    { ownerInteractive: true, agent: true },
    { ownerInteractive: true, hook: true },
  ])(
    'refuses non-owner authority before reading custody or creating a host: %j',
    async (authority) => {
      const current = fixture();
      await expect(
        current.service.advance({ planId, operationId, ...authority }),
      ).rejects.toMatchObject({
        code:
          authority.ownerInteractive === false
            ? 'E_LANDING_OWNER_INTERACTIVE_REQUIRED'
            : 'E_LANDING_MACHINE_AUTHORITY_FORBIDDEN',
      });
      expect(current.host).not.toHaveBeenCalled();
      expect(current.dispatch).not.toHaveBeenCalled();
    },
  );

  it('persists one intent CAS and rejects a divergent replay', async () => {
    const projectDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'openplanr-landing-custody-')));
    roots.push(projectDir);
    const custody = new LandingReceiptCustodyV1({
      root: path.join(projectDir, '.planr', 'landing'),
      now: () => Date.parse('2026-08-25T10:00:00.001Z'),
    });
    const plan = {
      planId,
      planHash: hash('d'),
      candidateDigest: hash('7'),
      currentTargetHash: targetHash,
      repositories: [{ repositoryKey: 'project', head: '9'.repeat(40) }],
    };
    await custody.initialize({ feature: 'landing-test', receiptHash, plan, baseRecords: [] });
    const event = {
      sequence: 1,
      timestamp: '2026-08-25T10:00:00.000Z',
      eventHash: hash('9'),
    };
    const request = {
      kind: 'landing-intent-cas',
      planHash: plan.planHash,
      runId: `lrun_${'a'.repeat(32)}`,
      operationId,
      requestHash: hash('b'),
      targetBeforeHash: targetHash,
      intentEventHash: event.eventHash,
      attemptIdentity: `latm_${'c'.repeat(32)}`,
      expectedJournalHead: { sequence: 0, hash: null },
      confirmation: { issuedAt: '2026-08-25T10:00:00.000Z' },
      events: [event],
    };
    const acknowledgement = await custody.commitIntent(planId, request);
    expect(acknowledgement).toMatchObject({ journalHead: { sequence: 1, hash: hash('9') } });
    await expect(
      custody.commitIntent(planId, { ...request, requestHash: hash('e') }),
    ).rejects.toMatchObject({ code: 'E_LANDING_CUSTODY_CONFLICT' });
  });
});
