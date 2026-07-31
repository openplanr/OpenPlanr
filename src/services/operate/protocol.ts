import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  OperateError,
  type OperatingAdapterHandoff,
  type OperatingAdvisorBrief,
  type OperatingCheckpoint,
  type OperatingEvent,
  type OperatingEvidenceIndexItem,
  type OperatingMissionPacket,
  type OperatingMissionToolGrant,
  type OperatingProviderManifest,
  type OperatingRoleResult,
  type OperatingState,
} from './types.js';

/**
 * Options accepted by the pipeline's Protocol v1.3 `createOperatingMissionPacket`.
 * The engine sources every non-evidence value from live cycle/workspace state.
 */
export interface CreateOperatingMissionPacketOptions {
  protocolVersion?: string;
  cycleId: string;
  pinnedRevision?: string;
  charter: OperatingMissionPacket['charter'];
  priorCycleSummary: OperatingMissionPacket['priorCycleSummary'];
  planningStatus: OperatingMissionPacket['planningStatus'];
  declaredRoots?: string[];
  toolGrant?: OperatingMissionToolGrant;
  maxEvidenceItems?: number;
}

interface PipelineProtocolApi {
  assertProtocolArtifact(kind: string, value: unknown): unknown;
  validateProtocolArtifact(
    kind: string,
    value: unknown,
  ): Array<{
    path: string;
    detail: string;
  }>;
  createOperatingEvent(
    input: Record<string, unknown>,
    options?: { previousEvent?: OperatingEvent | null; sequence?: number },
  ): OperatingEvent;
  verifyOperatingEventChain(
    events: OperatingEvent[],
    options?: { startingSequence?: number; startingHash?: string | null },
  ): { sequence: number; hash: `sha256:${string}` | null };
  reduceOperatingEvents(
    events: OperatingEvent[],
    options?: { checkpoint?: OperatingCheckpoint | null },
  ): OperatingState;
  createOperatingCheckpoint(
    state: OperatingState,
    options?: {
      createdAt?: string;
      recordDigests?: string[];
      signer?: (payload: string) => {
        algorithm: 'ed25519' | 'hmac-sha256';
        keyId: string;
        value: string;
      };
    },
  ): OperatingCheckpoint;
  validateOperatingCheckpoint(
    checkpoint: OperatingCheckpoint,
    options?: {
      verifySignature?: (
        payload: string,
        signature: {
          algorithm: 'ed25519' | 'hmac-sha256';
          keyId: string;
          value: string;
        },
      ) => boolean;
      requireSignatureVerification?: boolean;
    },
  ): OperatingCheckpoint;
  computeOperatingProviderPolicyDigest(manifest: OperatingProviderManifest): `sha256:${string}`;
  computeOperatingRoleResultDigest(result: OperatingRoleResult): `sha256:${string}`;
  validateOperatingRoleResultDigest(result: OperatingRoleResult): OperatingRoleResult;
  validateOperatingProviderPolicyDigest(
    manifest: OperatingProviderManifest,
  ): OperatingProviderManifest;
  createOperatingAdvisorBrief(roleId: string): OperatingAdvisorBrief;
  createOperatingAdapterHandoff(input: {
    phase: 'advisors' | 'chair';
    state: OperatingAdapterHandoff['state'];
    cycleId: string;
    evidenceDigest: string;
    runtime: string;
    idempotencyKey: string;
    lease?: string | null;
    expiresAt?: string | null;
    roles: Array<{
      roleId: string;
      status: OperatingAdapterHandoff['roles'][number]['status'];
      inputDigest?: string | null;
    }>;
  }): OperatingAdapterHandoff;
  validateOperatingAdapterHandoffBindings(value: OperatingAdapterHandoff): OperatingAdapterHandoff;
  listOperatingRoles(): Array<Record<string, unknown> & { id: string }>;
  listOperatingProviders(): Array<Record<string, unknown> & { id: string }>;
  /**
   * Protocol v1.3 mission-packet surface. Present only when the resolved
   * pipeline install ships the v1.3 schema directory and mission-packet module;
   * a v1.2-only install (pack mode) leaves these undefined.
   */
  createOperatingMissionPacket?: (
    roleId: string,
    evidenceItems: OperatingEvidenceIndexItem[],
    options: CreateOperatingMissionPacketOptions,
  ) => OperatingMissionPacket;
  createMissionToolGrant?: (roots?: string[]) => OperatingMissionToolGrant;
  MISSION_READ_ONLY_TOOLS?: readonly string[];
}

/**
 * The Protocol v1.3 mission-packet functions, imported directly from the
 * pipeline's `lib/operate/mission-packet.mjs`. The published protocol loader
 * (`lib/protocol/loader.mjs`) intentionally does not re-export these, so mission
 * mode resolves them from a v1.3-complete pipeline root of its own.
 */
export interface PipelineMissionApi {
  createOperatingMissionPacket: (
    roleId: string,
    evidenceItems: OperatingEvidenceIndexItem[],
    options: CreateOperatingMissionPacketOptions,
  ) => OperatingMissionPacket;
  createMissionToolGrant: (roots?: string[]) => OperatingMissionToolGrant;
  MISSION_READ_ONLY_TOOLS: readonly string[];
}

const require = createRequire(import.meta.url);
let cached: Promise<PipelineProtocolApi> | undefined;
let cachedMission: Promise<PipelineMissionApi> | undefined;

const MISSION_PACKET_SCHEMA = ['schemas', 'v1.3.0', 'operating-mission-packet.schema.json'];
const MISSION_PACKET_MODULE = ['lib', 'operate', 'mission-packet.mjs'];

function candidateRoots(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots: string[] = [];
  if (process.env.OPENPLANR_PIPELINE_ROOT) roots.push(process.env.OPENPLANR_PIPELINE_ROOT);
  try {
    roots.push(path.resolve(path.dirname(require.resolve('planr-pipeline/protocol')), '../..'));
  } catch {
    try {
      roots.push(path.resolve(path.dirname(require.resolve('planr-pipeline')), '../..'));
    } catch {
      // The planning-only installer intentionally omits the portable pipeline.
    }
  }
  roots.push(
    path.resolve(here, '../../../../planr-pipeline'),
    path.resolve(process.cwd(), '../planr-pipeline'),
  );
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

export function resolveOperatingPipelineRoot(
  options: { requireMission?: boolean } = {},
): string | null {
  for (const root of candidateRoots()) {
    const hasBaseContract =
      existsSync(path.join(root, 'lib', 'protocol', 'loader.mjs')) &&
      existsSync(path.join(root, 'schemas', 'v1.2.0', 'operating-event.schema.json'));
    if (!hasBaseContract) continue;
    // Pack mode resolves on the v1.2 contract alone, so a v1.2-only pipeline
    // install still resolves. Mission mode additionally requires the v1.3
    // schema directory and mission-packet module before it will bind a root.
    if (
      options.requireMission &&
      !(
        existsSync(path.join(root, ...MISSION_PACKET_SCHEMA)) &&
        existsSync(path.join(root, ...MISSION_PACKET_MODULE))
      )
    ) {
      continue;
    }
    return root;
  }
  return null;
}

export function operatingPipelineAvailable(): boolean {
  return resolveOperatingPipelineRoot() !== null;
}

/** Whether a Protocol v1.3 mission-capable pipeline install is resolvable. */
export function operatingMissionProtocolAvailable(): boolean {
  return resolveOperatingPipelineRoot({ requireMission: true }) !== null;
}

export async function loadOperatingProtocol(): Promise<PipelineProtocolApi> {
  const root = resolveOperatingPipelineRoot();
  if (!root) {
    throw new OperateError(
      'E_PIPELINE_NOT_INSTALLED',
      'Operating Board requires the full pipeline package with Protocol v1.2.',
      {
        recovery:
          'Run `npm install -g openplanr@latest` (without `--omit=optional`), then `planr setup --scope user`.',
      },
    );
  }
  cached ??= import(pathToFileURL(path.join(root, 'lib', 'protocol', 'loader.mjs')).href).then(
    async (value) => {
      const api = value as unknown as PipelineProtocolApi;
      // Attach the v1.3 mission surface when the install ships it. The pack path
      // never depends on it, so any resolution/import failure is swallowed and
      // pack-mode callers keep the frozen v1.2 API unchanged.
      try {
        const missionRoot = resolveOperatingPipelineRoot({ requireMission: true });
        if (missionRoot) {
          const mission = (await import(
            pathToFileURL(path.join(missionRoot, ...MISSION_PACKET_MODULE)).href
          )) as unknown as PipelineMissionApi;
          return {
            ...api,
            createOperatingMissionPacket: mission.createOperatingMissionPacket,
            createMissionToolGrant: mission.createMissionToolGrant,
            MISSION_READ_ONLY_TOOLS: mission.MISSION_READ_ONLY_TOOLS,
          } satisfies PipelineProtocolApi;
        }
      } catch {
        // Mission surface is optional; pack mode is unaffected.
      }
      return api;
    },
  );
  return cached;
}

/**
 * Load the Protocol v1.3 mission-packet API directly from a v1.3-complete
 * pipeline root. Fails closed with a named error when only a v1.2 (pack-mode)
 * pipeline is installed, so a mission dispatch can never silently degrade.
 */
export async function loadOperatingMissionApi(): Promise<PipelineMissionApi> {
  const root = resolveOperatingPipelineRoot({ requireMission: true });
  if (!root) {
    throw new OperateError(
      'E_OPERATE_MISSION_UNAVAILABLE',
      'Mission-mode dispatch requires the pipeline package with Protocol v1.3 (mission packets).',
      {
        recovery:
          'Install a pipeline build that ships schemas/v1.3.0 (planr-pipeline@0.33.0 or later), then re-run.',
      },
    );
  }
  cachedMission ??= import(pathToFileURL(path.join(root, ...MISSION_PACKET_MODULE)).href).then(
    (value) => value as unknown as PipelineMissionApi,
  );
  return cachedMission;
}

export async function assertOperatingArtifact<T>(kind: string, value: T): Promise<T> {
  const protocol = await loadOperatingProtocol();
  try {
    protocol.assertProtocolArtifact(kind, value);
  } catch (error) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      error instanceof Error ? error.message : `${kind} failed Protocol v1.2 validation.`,
      { kind },
    );
  }
  return value;
}

export async function validateOperatingArtifact(
  kind: string,
  value: unknown,
): Promise<Array<{ path: string; detail: string }>> {
  return (await loadOperatingProtocol()).validateProtocolArtifact(kind, value);
}
