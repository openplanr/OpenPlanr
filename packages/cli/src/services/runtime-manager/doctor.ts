import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { OwnedFile } from './global-state.js';

export type RuntimeDoctorDiagnostic = Readonly<{
  code: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}>;

export function classifyComponentDrift(input: {
  cliDrift: boolean;
  componentDrift: boolean;
  incompatibleDrift: boolean;
}): {
  drift: boolean;
  genuineDrift: boolean;
  upgradeOnlyDrift: boolean;
  status: 'pass' | 'warn' | 'fail';
} {
  const drift = input.componentDrift || input.incompatibleDrift;
  const genuineDrift = input.incompatibleDrift;
  const upgradeOnlyDrift = drift && !genuineDrift && input.cliDrift;
  const status: 'pass' | 'warn' | 'fail' = genuineDrift
    ? 'fail'
    : upgradeOnlyDrift
      ? 'warn'
      : drift
        ? 'fail'
        : 'pass';
  return { drift, genuineDrift, upgradeOnlyDrift, status };
}

/** Diagnoses byte ownership without mutating or repairing the managed targets. */
export function diagnoseManagedRuntimeFiles(
  files: readonly OwnedFile[],
  ownershipHash: (content: string | Buffer, kind: OwnedFile['kind'], marker?: string) => string,
): RuntimeDoctorDiagnostic | null {
  if (files.length === 0) return null;
  const conflicts: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    if (!existsSync(file.target)) missing.push(file.target);
    else if (ownershipHash(readFileSync(file.target), file.kind, file.marker) !== file.hash) {
      conflicts.push(file.target);
    }
  }
  return {
    code: conflicts.length ? 'migration-conflict' : 'managed-files',
    status: conflicts.length ? 'fail' : missing.length ? 'warn' : 'pass',
    message: conflicts.length
      ? `${conflicts.length} managed file(s) changed outside setup`
      : missing.length
        ? `${missing.length} managed file(s) are missing`
        : 'Managed runtime files match recorded ownership hashes',
    ...(conflicts.length || missing.length
      ? { fix: 'Run `planr setup --dry-run`, then explicitly approve repair or rollback.' }
      : {}),
  };
}

/** Validates the append-only public provenance surface without inventing repairs. */
export function diagnoseRuntimeProvenance(projectDir: string): RuntimeDoctorDiagnostic | null {
  const provenancePath = path.join(projectDir, '.planr', 'provenance.jsonl');
  if (!existsSync(provenancePath)) return null;
  const invalidLines: number[] = [];
  const lines = readFileSync(provenancePath, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as {
        event_id?: string;
        producer?: { product?: string };
      };
      if (!event.event_id || !event.producer?.product) invalidLines.push(index + 1);
    } catch {
      invalidLines.push(index + 1);
    }
  }
  return {
    code: invalidLines.length ? 'provenance-invalid' : 'provenance',
    status: invalidLines.length ? 'fail' : 'pass',
    message: invalidLines.length
      ? `Provenance contains invalid event lines: ${invalidLines.join(', ')}`
      : 'Provenance is append-only JSONL with identifiable producers',
    ...(invalidLines.length
      ? {
          fix: 'Repair the invalid bytes, then explicitly append a recovery event. Doctor will not invent history.',
        }
      : {}),
  };
}
