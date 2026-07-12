import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
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
}

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

export async function appendOpenPlanrProvenance(input: ProvenanceInput): Promise<void> {
  const target = path.join(input.projectDir, '.planr', 'provenance.jsonl');
  const event = {
    schema_version: '1.0.0',
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
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
  };
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (cause) {
    const error = new Error(`E_PROVENANCE_WRITE: Could not append ${target}`);
    error.name = 'E_PROVENANCE_WRITE';
    (error as Error & { cause?: unknown }).cause = cause;
    throw error;
  }
}
