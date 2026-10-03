import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliBoundaryError, toCliFailureEnvelope } from '../cli/error-boundary.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export interface ManagedStudioInstance {
  instanceId: string;
  pid: number;
  port: number;
  kind: string;
  status: string;
  startedAt?: string;
  projectRoot?: string;
}
interface DashboardApi {
  listDashboardServers(): Promise<ManagedStudioInstance[]>;
  stopDashboardServer(instanceId: string): Promise<Record<string, unknown>>;
}
interface StudioApi {
  listArtifactReviewServers(): Promise<ManagedStudioInstance[]>;
  stopArtifactReviewServer(instanceId: string): Promise<Record<string, unknown>>;
}
interface DesignDaemonApi {
  findRunningDaemon(): Promise<{
    instanceId?: string;
    pid: number;
    port: number;
    kind: string;
    version: number;
    startedAt?: string;
  } | null>;
  killRunningDaemon(running: unknown): Promise<boolean>;
}
async function designRuntime(): Promise<DesignDaemonApi | null> {
  const pipeline = resolvePipelinePackage(true);
  if (!pipeline) return null;
  const api = (await import(
    pathToFileURL(path.join(pipeline.root, 'lib/design-engine/daemon.mjs')).href
  )) as Partial<DesignDaemonApi>;
  return typeof api.findRunningDaemon === 'function' && typeof api.killRunningDaemon === 'function'
    ? (api as DesignDaemonApi)
    : null;
}
async function dashboardRuntime(): Promise<DashboardApi | null> {
  const pipeline = resolvePipelinePackage(true);
  if (!pipeline) return null;
  const api = (await import(
    pathToFileURL(path.join(pipeline.root, 'lib/dashboard/index.mjs')).href
  )) as Partial<DashboardApi>;
  return typeof api.listDashboardServers === 'function' &&
    typeof api.stopDashboardServer === 'function'
    ? (api as DashboardApi)
    : null;
}
async function runtime(): Promise<StudioApi> {
  const pipeline = resolvePipelinePackage(true);
  if (!pipeline)
    throw new CliBoundaryError('E_SERVER_RUNTIME_MISSING', 'The Studio runtime is unavailable.', {
      recovery: 'Run planr doctor to inspect your installation.',
    });
  const api = (await import(
    pathToFileURL(path.join(pipeline.root, 'lib/artifact/review-server.mjs')).href
  )) as Partial<StudioApi>;
  if (
    typeof api.listArtifactReviewServers !== 'function' ||
    typeof api.stopArtifactReviewServer !== 'function'
  )
    throw new CliBoundaryError(
      'E_SERVER_RUNTIME_INCOMPATIBLE',
      'The installed runtime does not support owned Studio lifecycle operations.',
      { recovery: 'Update OpenPlanr, then reopen the Studio.' },
    );
  return api as StudioApi;
}
export async function listManagedServers(): Promise<ManagedStudioInstance[]> {
  const instances = await (await runtime()).listArtifactReviewServers();
  const dashboards = await dashboardRuntime();
  if (dashboards) instances.push(...(await dashboards.listDashboardServers()));
  const daemon = await designRuntime();
  const running = await daemon?.findRunningDaemon();
  if (running?.instanceId)
    instances.push({
      instanceId: running.instanceId,
      pid: running.pid,
      port: running.port,
      kind: running.kind,
      status: 'running',
      ...(running.startedAt ? { startedAt: running.startedAt } : {}),
    });
  return instances;
}
export async function stopManagedServer(instanceId: string): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(instanceId))
    throw new CliBoundaryError(
      'E_SERVER_INSTANCE_REQUIRED',
      'Choose the Studio instance shown by planr server list.',
      { recovery: 'Use its instance ID; ports and process IDs are not shutdown authority.' },
    );
  const daemon = await designRuntime();
  const running = await daemon?.findRunningDaemon();
  if (daemon && running?.instanceId === instanceId) {
    if (!(await daemon.killRunningDaemon(running)))
      throw new CliBoundaryError(
        'E_SERVER_INSTANCE_CHANGED',
        'The design daemon instance changed before it could be stopped.',
        { recovery: 'Run planr server list and choose its current instance ID.' },
      );
    return { status: 'stopping' };
  }
  const dashboards = await dashboardRuntime();
  if (
    dashboards &&
    (await dashboards.listDashboardServers()).some((item) => item.instanceId === instanceId)
  )
    return dashboards.stopDashboardServer(instanceId);
  return (await runtime()).stopArtifactReviewServer(instanceId);
}

export interface ManagedServerSelection {
  target?: string;
  all?: boolean;
  project?: string;
  yes?: boolean;
}
export interface ManagedServerStopBatch {
  results: Array<{ instanceId: string; result: Record<string, unknown> }>;
  failures: Array<{ instanceId: string; code: string; problem: string; recovery?: string }>;
}

function validateSelection(selection: ManagedServerSelection): void {
  if (
    (selection.target !== undefined && (selection.all || selection.project !== undefined)) ||
    (selection.target === undefined && !selection.all && selection.project === undefined) ||
    (selection.project !== undefined && !selection.project.trim())
  )
    throw new CliBoundaryError(
      'E_SERVER_SELECTOR_INVALID',
      'Choose one recorded instance or port, --all, or --project <directory>.',
      { recovery: 'Run planr server list to inspect owned services before choosing a selector.' },
    );
  if (selection.all && selection.project === undefined && !selection.yes)
    throw new CliBoundaryError(
      'E_SERVER_CONFIRMATION_REQUIRED',
      'Stopping all owned local services requires --yes.',
      {
        recovery:
          'Inspect planr server list, then use server stop --all --yes or filter by --project.',
      },
    );
  if (
    selection.target !== undefined &&
    !/^[A-Za-z0-9_-]{22}$/u.test(selection.target) &&
    (!/^[1-9][0-9]{0,4}$/u.test(selection.target) || Number(selection.target) > 65535)
  )
    throw new CliBoundaryError(
      'E_SERVER_SELECTOR_INVALID',
      'The server selector must be a recorded instance ID or a port from 1 to 65535.',
      { recovery: 'Run planr server list and choose its instance ID or recorded port.' },
    );
}

/** Resolve selection only; a port or project never grants process authority. */
export function selectManagedServerInstances(
  instances: readonly ManagedStudioInstance[],
  selection: ManagedServerSelection,
): ManagedStudioInstance[] {
  validateSelection(selection);
  let selected: ManagedStudioInstance[];
  if (selection.target !== undefined) {
    const target = selection.target;
    selected = instances.filter((instance) =>
      /^[A-Za-z0-9_-]{22}$/u.test(target)
        ? instance.instanceId === target
        : instance.port === Number(target),
    );
    if (selected.length > 1)
      throw new CliBoundaryError(
        'E_SERVER_SELECTOR_AMBIGUOUS',
        'More than one owned instance matches this selector.',
        { recovery: 'Run planr server list and stop the exact instance ID instead.' },
      );
    if (!selected.length)
      throw new CliBoundaryError(
        'E_SERVER_SELECTION_EMPTY',
        'No currently owned local service matches this selector.',
        { recovery: 'Run planr server list again; never stop another process by its port or PID.' },
      );
  } else if (selection.project !== undefined) {
    const projectRoot = path.resolve(selection.project);
    selected = instances.filter(
      (instance) => instance.projectRoot && path.resolve(instance.projectRoot) === projectRoot,
    );
  } else selected = [...instances];
  return [...new Map(selected.map((instance) => [instance.instanceId, instance])).values()];
}

/** Capture recorded identities, then reauthenticate each exact owner before shutdown. */
export async function stopManagedServers(
  selection: ManagedServerSelection,
): Promise<ManagedServerStopBatch> {
  validateSelection(selection);
  const selected = selectManagedServerInstances(await listManagedServers(), selection);
  const batch: ManagedServerStopBatch = { results: [], failures: [] };
  for (const instance of selected) {
    try {
      batch.results.push({
        instanceId: instance.instanceId,
        result: await stopManagedServer(instance.instanceId),
      });
    } catch (error) {
      const failure = toCliFailureEnvelope(error, {
        code: 'E_SERVER_STOP_FAILED',
        problem:
          'The owned service could not be stopped. Run planr server list and retry its current instance.',
      });
      batch.failures.push({
        instanceId: instance.instanceId,
        code: failure.code,
        problem: failure.problem,
        ...(failure.recovery ? { recovery: failure.recovery } : {}),
      });
    }
  }
  return batch;
}
