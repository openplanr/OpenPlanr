import { randomUUID } from 'node:crypto';
import { constants, existsSync, readFileSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProvenanceInput {
  projectDir: string;
  artifactId: string;
  artifactPath: string;
  operation: string;
  productVersion: string;
  runtime?: string;
  phase?: string;
  runId?: string;
  eventId?: string;
  timestamp?: string;
  correlation?: {
    correlation_id: string;
    proposal_id: string;
    proposal_hash: string;
    transaction_id: string;
    receipt_hash: string;
  };
}

export type OpenPlanrProvenanceEvent = {
  schema_version: '1.0.0';
  event_id: string;
  timestamp: string;
  artifact_id: string;
  artifact_path: string;
  operation: string;
  producer: { product: 'openplanr'; version: string; runtime: string; phase: string };
  run_id: string;
  correlation?: NonNullable<ProvenanceInput['correlation']>;
};

/** @internal deterministic crash seams; never serialized into provenance. */
export type ProvenanceAppendHooks = {
  beforeWrite?: () => Promise<void> | void;
  afterPartialWrite?: () => Promise<void> | void;
  afterSyncBeforeReturn?: () => Promise<void> | void;
};

export function readOpenPlanrVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, '../../package.json'),
    path.resolve(here, '../../../package.json'),
  ]) {
    if (!existsSync(candidate)) continue;
    const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: string };
    if (pkg.version) return pkg.version;
  }
  return '0.0.0';
}

export function createOpenPlanrProvenanceEvent(input: ProvenanceInput): OpenPlanrProvenanceEvent {
  return {
    schema_version: '1.0.0',
    event_id: input.eventId ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    artifact_id: input.artifactId,
    artifact_path: path.relative(input.projectDir, input.artifactPath).replaceAll(path.sep, '/'),
    operation: input.operation,
    producer: {
      product: 'openplanr',
      version: input.productVersion,
      runtime: input.runtime ?? 'cli',
      phase: input.phase ?? 'planning',
    },
    run_id: input.runId ?? randomUUID(),
    ...(input.correlation === undefined ? {} : { correlation: input.correlation }),
  };
}

export async function appendOpenPlanrProvenance(
  input: ProvenanceInput,
  hooks: ProvenanceAppendHooks = {},
): Promise<OpenPlanrProvenanceEvent> {
  const target = path.join(input.projectDir, '.planr', 'provenance.jsonl');
  const event = createOpenPlanrProvenanceEvent(input);
  const serialized = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8');
  const conflict = (message: string): never => {
    throw Object.assign(new Error(message), { code: 'E_PROVENANCE_CONFLICT' });
  };
  const validateProtocolArtifact = input.correlation
    ? (await import('planr-pipeline/protocol')).validateProtocolArtifact
    : null;
  const validateRecord = (candidate: unknown): OpenPlanrProvenanceEvent => {
    if (validateProtocolArtifact) {
      const errors = validateProtocolArtifact('provenance-event', candidate, {
        protocolVersion: '1.1.0',
      });
      if (errors.length > 0) {
        conflict(
          `The provenance ledger contains a schema-invalid complete record at ${errors[0]?.path ?? '$'}.`,
        );
      }
      return candidate as OpenPlanrProvenanceEvent;
    }
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      typeof (candidate as OpenPlanrProvenanceEvent).event_id !== 'string'
    )
      conflict('The provenance ledger contains a malformed complete record.');
    return candidate as OpenPlanrProvenanceEvent;
  };
  const parseRecord = (line: string): OpenPlanrProvenanceEvent => {
    try {
      return validateRecord(JSON.parse(line));
    } catch (cause) {
      if ((cause as { code?: unknown })?.code === 'E_PROVENANCE_CONFLICT') throw cause;
      return conflict('The provenance ledger contains malformed interior custody.');
    }
  };
  validateRecord(event);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(
      target,
      constants.O_CREAT | constants.O_RDWR | constants.O_APPEND,
      0o600,
    );
    try {
      const existing = await handle.readFile();
      const hasPartialTerminal = existing.length > 0 && existing.at(-1) !== 0x0a;
      const terminalBoundary = existing.lastIndexOf(0x0a);
      const completeBytes = existing.subarray(0, terminalBoundary + 1);
      const terminal = hasPartialTerminal
        ? existing.subarray(terminalBoundary + 1)
        : Buffer.alloc(0);
      const split = completeBytes.toString('utf8').split('\n');
      split.pop();
      const records = split.map((line) => {
        if (line.length === 0) conflict('The provenance ledger contains an empty interior record.');
        return parseRecord(line.endsWith('\r') ? line.slice(0, -1) : line);
      });
      const matches = records.filter((candidate) => candidate.event_id === event.event_id);
      if (
        matches.length > 1 ||
        (matches.length === 1 && JSON.stringify(matches[0]) !== JSON.stringify(event))
      ) {
        conflict('The deterministic provenance identity is already bound to different custody.');
      }
      if (hasPartialTerminal) {
        if (
          !input.eventId ||
          matches.length !== 0 ||
          terminal.length === 0 ||
          !serialized.subarray(0, terminal.length).equals(terminal)
        ) {
          conflict('The terminal provenance fragment does not match the exact pending custody.');
        }
        await hooks.beforeWrite?.();
        await handle.writeFile(serialized.subarray(terminal.length));
        await handle.sync();
        await hooks.afterSyncBeforeReturn?.();
        return event;
      }
      if (matches.length === 1) {
        await handle.sync();
        return matches[0];
      }
      await hooks.beforeWrite?.();
      if (hooks.afterPartialWrite) {
        const boundary = Math.max(1, Math.floor(serialized.length / 2));
        await handle.writeFile(serialized.subarray(0, boundary));
        await handle.sync();
        await hooks.afterPartialWrite();
        await handle.writeFile(serialized.subarray(boundary));
      } else {
        await handle.writeFile(serialized);
      }
      await handle.sync();
      await hooks.afterSyncBeforeReturn?.();
      return event;
    } finally {
      await handle.close();
    }
  } catch (cause) {
    if ((cause as { code?: unknown })?.code === 'E_PROVENANCE_CONFLICT') throw cause;
    const error = new Error(`E_PROVENANCE_WRITE: Could not append ${target}`);
    error.name = 'E_PROVENANCE_WRITE';
    (error as Error & { cause?: unknown }).cause = cause;
    throw error;
  }
}
