/** Dashboard server entry; importing it does not load the package root. */
import type { Server, ServerResponse } from 'node:http';

/** Owner read of one Cycle workspace, bound to the requesting dashboard session. */
export interface DashboardCycleReadRequest {
  readonly cycleId: string;
  readonly actorId: string;
  readonly scopeId: string;
  readonly domainId: string;
  readonly domainVersion: string;
}

/** Owner read of one Review workspace, bound to the requesting dashboard session. */
export interface DashboardReviewReadRequest extends DashboardCycleReadRequest {
  readonly reviewId: string;
}

export interface DashboardServerOptions {
  /** Absolute dashboard build root; defaults to the packaged build. */
  staticRoot?: string;
  dashboardBuildId?: string;
  /** Defaults to `<cwd>/.planr`. */
  planrDir?: string;
  /** Starts the filesystem watcher on `listen()`; defaults to true. */
  watch?: boolean;
  /** Replaces the planning graph reader; the result is validated before it is served. */
  getGraph?: (request: Readonly<{ planrDir: string; scope: string | null }>) => unknown;
  /** Replaces the planning node reader; `null` or `undefined` means not found. */
  getNode?: (id: string) => unknown;
  planningActorId?: string | null;
  getOperatingProjection?: () => unknown;
  getOperatingExperience?: () => unknown;
  getOperatingCycleRead?: ((request: DashboardCycleReadRequest) => Promise<unknown>) | null;
  getOperatingReviewRead?: ((request: DashboardReviewReadRequest) => Promise<unknown>) | null;
  /** Gateways are discovered by method; one without the command methods keeps routes read-only. */
  getOperatingCommandGateway?: (() => object | null) | null;
  getOperatingPlanningGateway?: (() => object | null) | null;
}

export interface DashboardPlanningCursor {
  readonly eventHead: Readonly<{ sequence: number; hash: string | null }>;
  readonly viewHash: string | null;
}

export interface DashboardLiveClient {
  readonly res: ServerResponse;
  readonly binding: unknown;
}

export interface DashboardServer {
  readonly server: Server;
  readonly sseClients: Set<ServerResponse>;
  readonly planningSseClients: Set<DashboardLiveClient>;
  readonly operateSseClients: Set<DashboardLiveClient & { readonly surface: string }>;
  readonly staticRoot: string;
  getCurrentGraph(): unknown;
  getPlanningCursor(): DashboardPlanningCursor;
  /** False when the patch was rejected and live planning clients were sent a stale event. */
  acceptPlanningWatcherPatch(patch: unknown): boolean;
  getCurrentExperience(): unknown;
  getOperatingCommandGateway(): object | null;
  getOperatingPlanningGateway(): object | null;
  refreshOperatingExperience(): unknown;
  isWatching(): boolean;
  broadcast(event: string, payload: unknown): void;
  /** Whether the last `listen()` reused a compatible running dashboard. */
  readonly reused: boolean;
  readonly ownerPid: number;
  /** Binds 127.0.0.1 and resolves the bound port; a compatible running dashboard is reused. */
  listen(
    port?: number,
    options?: { env?: Readonly<Record<string, string | undefined>> },
  ): Promise<number>;
  close(): Promise<void>;
}

export function startDashboard(options?: DashboardServerOptions): DashboardServer;
