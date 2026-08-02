import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validateJson } from '../../conformance/json-schema-validate.mjs';
import { PipelineError } from './errors.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaPath = join(root, 'schemas/v1.1.0/provenance-event.schema.json');
const schema = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(schemaPath, 'utf8')));

export function createProvenanceEvent({
  projectRoot,
  artifactId,
  artifactPath,
  operation,
  product,
  version,
  runtime,
  phase,
  runId = randomUUID(),
  eventId = randomUUID(),
  timestamp = new Date().toISOString(),
}) {
  const normalizedPath = artifactPath.startsWith(projectRoot)
    ? relative(projectRoot, artifactPath).split('\\').join('/')
    : artifactPath.split('\\').join('/');
  return {
    schema_version: '1.0.0',
    event_id: eventId,
    timestamp,
    artifact_id: artifactId,
    artifact_path: normalizedPath,
    operation,
    producer: { product, version, runtime, phase },
    run_id: runId,
  };
}

export function appendProvenanceEvent(projectRoot, event) {
  const errors = validateJson(event, schema);
  if (errors.length > 0) {
    throw new PipelineError(
      'E_PROVENANCE_INVALID',
      `Provenance event is invalid at ${errors[0].path}: ${errors[0].detail}`,
      'Fix the producer metadata before retrying the operation.',
    );
  }

  const planrDir = join(projectRoot, '.planr');
  const target = join(planrDir, 'provenance.jsonl');
  try {
    if (!existsSync(planrDir)) mkdirSync(planrDir, { recursive: true });
    const fd = openSync(target, 'a', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(event)}\n`, null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    throw new PipelineError(
      'E_PROVENANCE_WRITE',
      `Could not append ${target}: ${error.message}`,
      'Repair the file permissions, then rerun `planr provenance recover --confirm`.',
    );
  }
  return target;
}
