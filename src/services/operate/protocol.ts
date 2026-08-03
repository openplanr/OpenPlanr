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
  type OperatingProviderManifest,
  type OperatingRoleResult,
  type OperatingState,
} from './types.js';

interface PipelineProtocolApi {
  assertProtocolArtifact(kind: string, value: unknown): unknown;
  validateProtocolArtifact(
    kind: string,
    value: unknown,
    // v1.3 callers (e.g. the mission-mode `operating-advisor-response`, which
    // carries no protocol envelope) pass the version explicitly; a v1.2 caller
    // omits it and the pipeline additively resolves to the earliest schema.
    options?: { protocolVersion?: string },
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
    // Passed through to the pipeline's `adapter-handoff.mjs`, which defaults it
    // to '1.2.0' (pack mode) and switches the record action to the v1.3 mission
    // dispatch shape — `dispatch.agent` + `dispatch.missionPacketPointer` — when
    // '1.3.0'. Passthrough only; the pipeline owns validation.
    protocolVersion?: string;
    phase: 'bootstrap' | 'advisors' | 'chair';
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
      // A non-recorded terminal role (`not-evaluated`/`failed`) carries the reason
      // it is missing; the pipeline builder omits the field for every other status.
      statusReason?: string | null;
      inputDigest?: string | null;
    }>;
  }): OperatingAdapterHandoff;
  validateOperatingAdapterHandoffBindings(value: OperatingAdapterHandoff): OperatingAdapterHandoff;
  listOperatingRoles(): Array<Record<string, unknown> & { id: string }>;
  listOperatingProviders(): Array<Record<string, unknown> & { id: string }>;
}

const require = createRequire(import.meta.url);
let cached: Promise<PipelineProtocolApi> | undefined;

const OPERATING_MANDATE_SCHEMA = ['schemas', 'v1.4.0', 'operating-mandate.schema.json'];
const OPERATING_MANDATE_MODULE = ['lib', 'operate', 'mandate.mjs'];

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
    // The base v1.2 reader remains available for existing artifacts. Agent-native
    // execution additionally requires the Protocol v1.4 mandate contract.
    if (
      options.requireMission &&
      !(
        existsSync(path.join(root, ...OPERATING_MANDATE_SCHEMA)) &&
        existsSync(path.join(root, ...OPERATING_MANDATE_MODULE))
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

/** Whether a Protocol v1.4 agent-native pipeline install is resolvable. */
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
    (value) => value as unknown as PipelineProtocolApi,
  );
  return cached;
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
