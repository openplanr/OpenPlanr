import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { verifyDashboardAssets } from '../../../lib/dashboard-verifier.mjs';
import type { OperateCommandGateway } from '../../services/operate/command-gateway.js';
import type { OperatePlanningGateway } from '../../services/operate/planning-handoff-gateway.js';
import { CliBoundaryError } from '../error-boundary.js';
import {
  type OperateNoteContractVersionSelector,
  type OperateNoteValidationProfile,
  type OperateNoteValidationResult,
  registerOperateCommandDefinition,
} from './operate/registration.js';

export type { OperateExperienceSurfaceData } from './operate/render.js';
export { renderOperateExperienceSurfaceHuman } from './operate/render.js';

type DashboardHandle = {
  listen(port?: number, options?: { env?: NodeJS.ProcessEnv }): Promise<number>;
  close(): Promise<void>;
};

type DashboardStarter = (options: {
  planrDir: string;
  staticRoot: string;
  dashboardBuildId?: string;
  watch: boolean;
  planningActorId: string;
  getOperatingExperience: () => Record<string, unknown>;
  getOperatingCycleRead?: (request: {
    cycleId: string;
    actorId: string;
    scopeId: string;
    domainId: string;
    domainVersion: string;
  }) => Promise<Record<string, unknown>>;
  getOperatingReviewRead?: (request: {
    cycleId: string;
    reviewId: string;
    actorId: string;
    scopeId: string;
    domainId: string;
    domainVersion: string;
  }) => Promise<Record<string, unknown>>;
  getOperatingCommandGateway: () => OperateCommandGateway;
  getOperatingPlanningGateway?: () => OperatePlanningGateway;
}) => DashboardHandle;

const PIPELINE_ROOT_MODULE = 'planr-pipeline';
const OPERATE_CLIENT_MODULE = '../../services/operate/client.js';
const OPERATE_GATEWAY_MODULE = '../../services/operate/command-gateway.js';
const OPERATE_PACKET_MODULE = '../../services/operate/assignment-packet-service.js';
const OPERATE_DOMAIN_CATALOG_MODULE = '../../services/operate/domain-catalog-service.js';
const OPERATE_REVIEW_NOTE_MODULE: string = '../../../lib/skill-runtime/operate-review-note.mjs';

export function installedOpenPlanrDashboardRoot(): string {
  if (
    typeof process.env.OPENPLANR_DASHBOARD_ROOT === 'string' &&
    process.env.OPENPLANR_DASHBOARD_ROOT.length > 0
  ) {
    return resolve(process.env.OPENPLANR_DASHBOARD_ROOT);
  }
  const commandModuleDirectory = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(commandModuleDirectory, '../../..');
  const localDashboard = join(packageRoot, 'dist', 'dashboard');
  if (existsSync(join(localDashboard, 'dashboard-manifest.json'))) {
    return localDashboard;
  }
  try {
    const require = createRequire(import.meta.url);
    const packageName = ['open', 'planr'].join('');
    const packageJson = require.resolve(`${packageName}/package.json`);
    const installedDashboard = resolve(dirname(packageJson), 'dist', 'dashboard');
    if (existsSync(join(installedDashboard, 'dashboard-manifest.json'))) {
      return installedDashboard;
    }
  } catch {
    // Installed package graph may not include OpenPlanr.
  }
  return localDashboard;
}

export function installedOpenPlanrDashboardBuildId(): string {
  const root = installedOpenPlanrDashboardRoot();
  const report = verifyDashboardAssets(root);
  if (!report.ok || typeof report.buildId !== 'string') {
    throw new CliBoundaryError(
      report.code ?? 'E_DASHBOARD_MANIFEST_INVALID',
      report.problem ?? 'The installed OpenPlanr dashboard manifest is invalid.',
      {
        recovery: 'Reinstall OpenPlanr from a complete verified package archive.',
        ...(report.code === 'E_DASHBOARD_ASSETS_MISSING' ? { missing: ['dashboardAssets'] } : {}),
      },
    );
  }
  return report.buildId;
}

type OperateClientModule = typeof import('../../services/operate/client.js');
type OperateGatewayModule = typeof import('../../services/operate/command-gateway.js');
type OperatePacketModule = typeof import('../../services/operate/assignment-packet-service.js');
type OperateDomainCatalogModule = typeof import('../../services/operate/domain-catalog-service.js');
type OperateReviewNoteModule = {
  inspectOperateReviewNote: (
    markdown: string,
    options: {
      profile: OperateNoteValidationProfile;
      contractVersion?: OperateNoteContractVersionSelector;
    },
  ) => OperateNoteValidationResult;
};

function operateDependencyUnavailable(error: unknown): Error {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const missingModule =
    candidate?.code === 'ERR_MODULE_NOT_FOUND' || candidate?.code === 'MODULE_NOT_FOUND';
  if (!missingModule || !message.includes('planr-pipeline')) {
    return error instanceof Error ? error : new Error('The Operate runtime could not be loaded.');
  }
  return Object.assign(
    new Error(
      'Operate requires the optional planr-pipeline package. Reinstall OpenPlanr with optional dependencies (do not use --omit=optional).',
    ),
    { code: 'E_OPERATE_PIPELINE_MISSING' },
  );
}

async function loadOperateClientModule(): Promise<OperateClientModule> {
  try {
    return await import(OPERATE_CLIENT_MODULE);
  } catch (error) {
    throw operateDependencyUnavailable(error);
  }
}

async function loadOperateGatewayModule(): Promise<OperateGatewayModule> {
  try {
    return await import(OPERATE_GATEWAY_MODULE);
  } catch (error) {
    throw operateDependencyUnavailable(error);
  }
}

async function loadOperatePacketModule(): Promise<OperatePacketModule> {
  try {
    return await import(OPERATE_PACKET_MODULE);
  } catch (error) {
    throw operateDependencyUnavailable(error);
  }
}

async function loadOperateDomainCatalogModule(): Promise<OperateDomainCatalogModule> {
  try {
    return await import(OPERATE_DOMAIN_CATALOG_MODULE);
  } catch (error) {
    throw operateDependencyUnavailable(error);
  }
}

async function loadOperateReviewNoteModule(): Promise<OperateReviewNoteModule> {
  try {
    const loaded = (await import(OPERATE_REVIEW_NOTE_MODULE)) as Partial<OperateReviewNoteModule>;
    if (typeof loaded.inspectOperateReviewNote !== 'function')
      throw new Error('Missing inspector.');
    return loaded as OperateReviewNoteModule;
  } catch (error) {
    throw new CliBoundaryError(
      'E_OPERATE_NOTE_VALIDATOR_UNAVAILABLE',
      'The installed OpenPlanr package does not contain the Operate note validator.',
      {
        cause: error,
        recovery: 'Reinstall OpenPlanr from a complete verified package archive.',
      },
    );
  }
}

export type StartedOperateDashboard = {
  url: string;
  port: number;
  close(): Promise<void>;
};

async function installedDashboardStarter(): Promise<DashboardStarter> {
  const installed = (await import(PIPELINE_ROOT_MODULE)) as unknown as {
    startDashboard?: DashboardStarter;
  };
  if (typeof installed.startDashboard !== 'function') {
    throw Object.assign(
      new Error('The installed planr-pipeline package does not expose the Operate dashboard.'),
      { code: 'E_OPERATE_DASHBOARD_UNAVAILABLE' },
    );
  }
  return installed.startDashboard;
}

function operatingExperienceRead(view: Record<string, unknown>): Record<string, unknown> {
  const status = typeof view.status === 'string' ? view.status : 'invalid';
  return {
    available: true,
    readOnly: status !== 'ready',
    status,
    view: structuredClone(view),
    reasonCodes: status === 'ready' ? [] : ['OPERATE_READ_ONLY'],
    recovery:
      status === 'ready'
        ? null
        : 'Resume the durable cycle through OpenPlanr before submitting a command.',
  };
}

/**
 * Production Operate command-center seam. The browser receives only public
 * projections and opaque action references; all state and command authority
 * remain in the installed OpenPlanr client/runtime in this loopback process.
 */
export async function startOperateDashboard(input: {
  projectDir: string;
  cycleId: string;
  actorId: string;
  port?: number;
  watch?: boolean;
  env?: NodeJS.ProcessEnv;
  client?: ReturnType<Awaited<ReturnType<typeof loadOperateClientModule>>['createOperateClient']>;
  startDashboard?: DashboardStarter;
}): Promise<StartedOperateDashboard> {
  const [
    { createOperateClient },
    {
      createOperateClientCommandRuntime,
      createOperateCommandGateway,
      createOperatingReviewReadGatewayV1,
    },
  ] = await Promise.all([loadOperateClientModule(), loadOperateGatewayModule()]);
  const { createOperatePlanningGateway } = await import(
    '../../services/operate/planning-handoff-gateway.js'
  );
  const client = input.client ?? createOperateClient(input.projectDir);
  const actor = { actorId: input.actorId, kind: 'human' as const, runtime: 'openplanr' };
  const envelope = await client.dispatch({
    operation: 'operate.experience.get',
    request: {
      cycleId: input.cycleId,
      actor,
      actionBinding: { cycleId: input.cycleId, actorId: input.actorId },
    },
  });
  if (!envelope.ok) {
    throw Object.assign(new Error(envelope.error.message), { code: envelope.error.code });
  }
  let projection = operatingExperienceRead(envelope.data as Record<string, unknown>);
  const getOperatingReviewRead = createOperatingReviewReadGatewayV1({ client });
  const gateway = createOperateCommandGateway({
    client,
    runtime: createOperateClientCommandRuntime(client, getOperatingReviewRead),
    getOperatingReviewRead,
    onView: (view) => {
      projection = operatingExperienceRead(view);
    },
  });
  const planningGateway = createOperatePlanningGateway({
    client,
    projectDir: input.projectDir,
  });
  const startDashboard = input.startDashboard ?? (await installedDashboardStarter());
  const staticRoot = installedOpenPlanrDashboardRoot();
  const dashboard = startDashboard({
    planrDir: join(input.projectDir, '.planr'),
    staticRoot,
    dashboardBuildId: installedOpenPlanrDashboardBuildId(),
    watch: input.watch ?? true,
    planningActorId: input.actorId,
    getOperatingExperience: () => structuredClone(projection),
    getOperatingCycleRead: async ({ cycleId }) =>
      structuredClone(
        (await client.dispatch({
          operation: 'operate.cycle.get',
          request: { cycleId },
        })) as unknown as Record<string, unknown>,
      ),
    getOperatingReviewRead: async (request) =>
      structuredClone(
        (await getOperatingReviewRead(request)) as unknown as Record<string, unknown>,
      ),
    getOperatingCommandGateway: () => gateway,
    getOperatingPlanningGateway: () => planningGateway,
  });
  const port = await dashboard.listen(input.port ?? 7473, { env: input.env });
  return Object.freeze({
    url: `http://127.0.0.1:${port}/#/operate/today`,
    port,
    close: async () => await dashboard.close(),
  });
}

export function registerOperateCommand(program: Command): void {
  registerOperateCommandDefinition(program, {
    createClient: async (projectDir) => {
      const { createOperateClient } = await loadOperateClientModule();
      return createOperateClient(projectDir);
    },
    createAssignmentPacketService: async (projectDir) => {
      const { createOperateAssignmentPacketService } = await loadOperatePacketModule();
      return createOperateAssignmentPacketService(projectDir);
    },
    listDomains: async () => {
      const { listInstalledPublicOperatingDomains } = await loadOperateDomainCatalogModule();
      return await listInstalledPublicOperatingDomains();
    },
    inspectOperateReviewNote: async (markdown, options) => {
      const { inspectOperateReviewNote } = await loadOperateReviewNoteModule();
      return inspectOperateReviewNote(markdown, options);
    },
    startDashboard: startOperateDashboard,
  });
}
