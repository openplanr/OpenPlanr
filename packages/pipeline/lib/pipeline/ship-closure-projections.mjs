import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter, splitFrontmatter } from '../dashboard/graph-reader.mjs';
import { validateProtocolArtifact } from '../protocol/contracts.mjs';
import { PipelineError } from './errors.mjs';
import { captureCandidate, pathsIntersect } from './ship-closure-identity.mjs';
import {
  assertPathCustody,
  atomicWrite,
  closurePaths,
  withLock,
} from './ship-closure-persistence.mjs';
import { createProvenanceEvent } from './provenance.mjs';
import { assertClosure, assertShipReceiptLineage } from './ship-closure-reducer.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const shippedMarkerSchema = JSON.parse(
  readFileSync(join(packageRoot, 'schemas/v1.0.0/pipeline-shipped.schema.json'), 'utf8'),
);
const shippedAgentRoles = new Set(shippedMarkerSchema.properties.agents_invoked.items.enum);

function fail(code, message) {
  throw new PipelineError(code, message);
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function posix(value) {
  return value.split('\\').join('/');
}

function assertProjectionFile(path, { allowMissing = true } = {}) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile())
    fail('E_SHIP_PROJECTION_UNSAFE', `Projection custody target is not a regular file: ${path}`);
}

export function renderShipClosureMarker(marker) {
  const lines = [];
  for (const [key, value] of Object.entries(marker)) {
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else {
        lines.push(`${key}:`);
        value.forEach((item) => lines.push(`  - ${JSON.stringify(item)}`));
      }
    } else if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [nested, nestedValue] of Object.entries(value))
        lines.push(`  ${nested}: ${JSON.stringify(nestedValue)}`);
    } else lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function artifact(path) {
  assertProjectionFile(path, { allowMissing: false });
  const text = readFileSync(path, 'utf8');
  const split = splitFrontmatter(text);
  return { path, text, frontmatter: parseFrontmatter(split.raw) };
}

function walk(root, predicate, acc = []) {
  if (!existsSync(root)) return acc;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, predicate, acc);
    else if (entry.isFile() && predicate(entry.name)) acc.push(path);
  }
  return acc;
}

function completeDefinitionOfDone(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{2,4}\s+Definition of done\s*$/i.test(line.trim()));
  if (start === -1) return text;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,4}\s+/.test(lines[index])) break;
    lines[index] = lines[index].replace(/^(\s*-\s+)\[\s\]/, '$1[x]');
  }
  return lines.join(newline);
}

function setArtifactStatus(path, status, updatedDate, completeDod = false) {
  assertProjectionFile(path, { allowMissing: false });
  const text = readFileSync(path, 'utf8');
  let next = /^status:\s*.*$/m.test(text)
    ? text.replace(/^status:\s*.*$/m, `status: "${status}"`)
    : text.replace(/^---\n/, `---\nstatus: "${status}"\n`);
  if (/^updated:\s*.*$/m.test(next))
    next = next.replace(/^updated:\s*.*$/m, `updated: "${updatedDate}"`);
  if (completeDod) next = completeDefinitionOfDone(next);
  if (next !== text) atomicWrite(path, next);
}

function readAllTerminalReceipts(featureRoot, { projectRoot, feature, mode } = {}) {
  const directory = join(featureRoot, '.ship', 'receipts');
  if (!existsSync(directory)) return [];
  const receipts = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      assertProjectionFile(path, { allowMissing: false });
      let value;
      try {
        value = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        fail('E_SHIP_CLOSURE_INVALID', `${path}: ${error.message}`);
      }
      const receipt = assertClosure(value);
      if (receipt.runId !== name.replace(/\.json$/, '') || receipt.recordType !== 'receipt') {
        fail(
          'E_SHIP_STORAGE_CONTEXT_INVALID',
          `Terminal receipt ${path} does not match its storage filename or record type.`,
        );
      }
      const expectedFeatureRoot = projectRoot ? posix(relative(projectRoot, featureRoot)) : null;
      if (
        (feature && receipt.feature !== feature) ||
        (mode && receipt.mode !== mode) ||
        (expectedFeatureRoot && receipt.approvedScope.featureRoot !== expectedFeatureRoot)
      ) {
        fail(
          'E_SHIP_STORAGE_CONTEXT_INVALID',
          `Terminal receipt ${path} belongs to a foreign feature context.`,
        );
      }
      return receipt;
    });
  return assertShipReceiptLineage(receipts);
}

function terminalLeafReceipts(featureRoot, context) {
  const receipts = readAllTerminalReceipts(featureRoot, context);
  const superseded = new Set(
    receipts.map(({ startedFromReceiptHash }) => startedFromReceiptHash).filter(Boolean),
  );
  return receipts.filter(({ receiptHash }) => !superseded.has(receiptHash));
}

function projectStatuses(receipt, projectRoot, featureRoot, { apply = true } = {}) {
  const terminalReceipts = terminalLeafReceipts(featureRoot, {
    projectRoot,
    feature: receipt.feature,
    mode: receipt.mode,
  });
  const protectedPaths = terminalReceipts.flatMap((terminalReceipt) =>
    terminalReceipt.tasks.flatMap(({ preserve }) =>
      preserve.filter(({ repositoryKey }) => repositoryKey === 'project'),
    ),
  );
  const isProtected = (path) =>
    protectedPaths.some((boundary) => pathsIntersect(boundary, { repositoryKey: 'project', path }));
  const updatedDate =
    terminalReceipts
      .map(({ terminal }) => terminal.at)
      .sort()
      .at(-1)
      ?.slice(0, 10) ?? receipt.terminal.at.slice(0, 10);
  const receiptTask = new Map();
  for (const terminalReceipt of terminalReceipts) {
    for (const task of terminalReceipt.tasks) {
      if (receiptTask.has(task.id))
        fail(
          'E_SHIP_PROJECTION_CONFLICT',
          `Multiple terminal leaf receipts claim task ${task.id}.`,
        );
      receiptTask.set(task.id, task);
    }
  }
  const taskStatus = new Map();
  let consistent = true;
  const planningTasks = walk(
    featureRoot,
    (name) => /^(?:T-|task-).*\.md$/i.test(name) && !/error-report/i.test(name),
  ).map(artifact);
  for (const taskArtifact of planningTasks) {
    const id = taskArtifact.frontmatter.id;
    const terminalTask = receiptTask.get(id);
    let projected = taskArtifact.frontmatter.status ?? 'pending';
    const relativePath = posix(relative(projectRoot, taskArtifact.path));
    if (terminalTask && !isProtected(relativePath)) {
      if (terminalTask.path.repositoryKey !== 'project' || terminalTask.path.path !== relativePath)
        fail(
          'E_SHIP_PROJECTION_INVALID',
          `Planning task ${id} path disagrees with terminal receipt custody.`,
        );
      projected = terminalTask.status === 'completed' ? 'done' : 'blocked';
      if (taskArtifact.frontmatter.status !== projected) consistent = false;
      if (apply) setArtifactStatus(taskArtifact.path, projected, updatedDate, projected === 'done');
    }
    taskStatus.set(id, projected);
  }
  const allDone =
    planningTasks.length > 0 &&
    planningTasks.every(({ frontmatter }) => {
      const terminalTask = receiptTask.get(frontmatter.id);
      return terminalTask?.status === 'completed';
    });
  const stories = walk(featureRoot, (name) => /^US-.*\.md$/i.test(name)).map(artifact);
  for (const story of stories) {
    if (isProtected(posix(relative(projectRoot, story.path)))) continue;
    const related = planningTasks.filter(
      ({ frontmatter }) => frontmatter.storyId === story.frontmatter.id,
    );
    if (related.length) {
      const statuses = related.map(({ frontmatter }) => taskStatus.get(frontmatter.id));
      const status = statuses.every((candidate) => candidate === 'done')
        ? 'done'
        : statuses.some((candidate) => candidate === 'blocked')
          ? 'blocked'
          : 'implementing';
      if (story.frontmatter.status !== status) consistent = false;
      if (apply) setArtifactStatus(story.path, status, updatedDate);
    }
  }
  const spec = walk(featureRoot, (name) =>
    receipt.mode === 'spec-driven' ? /^SPEC-.*\.md$/.test(name) : /^spec-.*\.md$/.test(name),
  )[0];
  if (spec && !isProtected(posix(relative(projectRoot, spec)))) {
    const status = allDone ? 'done' : 'in-pipeline';
    if (artifact(spec).frontmatter.status !== status) consistent = false;
    if (apply) setArtifactStatus(spec, status, updatedDate);
  }
  return { spec: spec ? artifact(spec) : null, allDone, terminalReceipts, consistent };
}

function aggregateProjection(statusProjection) {
  const receipts = statusProjection.terminalReceipts;
  const passed =
    statusProjection.allDone &&
    receipts.length > 0 &&
    receipts.every(({ state }) => state === 'passed');
  return {
    status: passed ? 'passed' : 'blocked',
    allDone: statusProjection.allDone,
    receiptCount: receipts.length,
    tasksExecuted: receipts
      .flatMap(({ tasks }) => tasks)
      .filter(({ status }) => status === 'completed').length,
    tasksFailed: receipts.flatMap(({ tasks }) => tasks).filter(({ status }) => status === 'blocked')
      .length,
  };
}

export function renderShipClosureQaReport(receipt, { aggregate = undefined } = {}) {
  const status = aggregate?.status ?? receipt.state;
  const lines = [
    `# ${receipt.feature} QA Report`,
    '',
    `Status: ${status === 'passed' ? 'PASS' : 'BLOCKED'}`,
    '',
    `Closure receipt: \`${receipt.receiptHash}\``,
    `Candidate: \`${receipt.terminal.candidateDigest}\``,
    `Gate evidence: \`${receipt.terminal.gateEvidenceDigest}\``,
    '',
  ];
  for (const review of receipt.reviews) {
    lines.push(
      `## ${review.phase === 'initial' ? 'Initial consolidated review' : 'Targeted re-review'}`,
      '',
      review.summary,
      '',
    );
    if (!review.findings.length) lines.push('- No findings.', '');
    else {
      review.findings.forEach((finding) =>
        lines.push(
          `- **${finding.severity} ${finding.id} — ${finding.title}** (${finding.disposition}): ${finding.evidence}`,
        ),
      );
      lines.push('');
    }
  }
  lines.push('## Frozen gates', '');
  for (const gate of receipt.gates) {
    const final = [...receipt.gateEvidence].reverse().find((entry) => entry.gateId === gate.id);
    lines.push(`- ${gate.id}: ${final?.status ?? 'missing'} (${final?.phase ?? 'none'})`);
  }
  return `${lines.join('\n')}\n`;
}

function readManifest(path) {
  if (!existsSync(path)) return [];
  assertProjectionFile(path, { allowMissing: false });
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!line) return [];
      try {
        const value = JSON.parse(line);
        const errors = validateProtocolArtifact('run-manifest', value, {
          protocolVersion: '1.0.0',
        });
        if (errors.length) throw new Error(`${errors[0].path}: ${errors[0].detail}`);
        return [value];
      } catch (error) {
        fail('E_RUN_MANIFEST_INVALID', `${path}:${index + 1}: ${error.message}`);
      }
    });
}

function changedSurfaces(receipt) {
  const surfaces = [];
  for (const entry of receipt.candidateRevisions.at(-1)?.inventory ?? []) {
    const qualify = (path) =>
      entry.repositoryKey === 'project' ? path : `${entry.repositoryKey}:${path}`;
    surfaces.push(qualify(entry.path));
    if (entry.originalPath) surfaces.push(qualify(entry.originalPath));
  }
  return [...new Set(surfaces)].sort();
}

export function buildShipClosureManifestRow(receipt, projectRoot, featureRoot) {
  return {
    stage: `ship.closure:${receipt.runId}`,
    agent: 'qa-agent',
    started_at: receipt.createdAt,
    ended_at: receipt.terminal.at,
    files_written: [
      posix(relative(projectRoot, join(featureRoot, '.ship', 'receipts', `${receipt.runId}.json`))),
    ],
    files_modified: changedSurfaces(receipt),
    exit_status: receipt.state === 'passed' ? 'success' : 'failure',
    error_summary:
      receipt.state === 'passed' ? null : (receipt.terminal.reason ?? 'SHIP closure blocked.'),
    ...(receipt.operatingOriginCorrelation === null
      ? {}
      : { operating_origin: receipt.operatingOriginCorrelation }),
  };
}

export function buildShipClosureMarker(
  receipt,
  { manifestBytes, rowIndex, aggregate = undefined },
) {
  const agents = [];
  for (const candidate of [...receipt.tasks.map(({ agent }) => agent), 'qa-agent']) {
    if (shippedAgentRoles.has(candidate) && !agents.includes(candidate)) agents.push(candidate);
  }
  return {
    shipped_at: receipt.terminal.at,
    pipeline_version: pkg.version,
    runtime: receipt.runtime,
    mode: receipt.mode,
    feature: receipt.feature,
    tasks_executed:
      aggregate?.tasksExecuted ??
      receipt.tasks.filter(({ status }) => status === 'completed').length,
    tasks_failed:
      aggregate?.tasksFailed ?? receipt.tasks.filter(({ status }) => status === 'blocked').length,
    qa_gate_status: (aggregate?.status ?? receipt.state) === 'passed' ? 'passed' : 'failed',
    delivery_status: (aggregate?.status ?? receipt.state) === 'passed' ? 'succeeded' : 'blocked',
    duration_seconds: Math.max(
      1,
      Math.floor((Date.parse(receipt.terminal.at) - Date.parse(receipt.createdAt)) / 1000),
    ),
    agents_invoked: agents,
    devops_status: 'skipped',
    docs_status: 'skipped',
    snapshot_status: 'skipped',
    error_reports: [],
    run_id: receipt.runId,
    manifest_hash: digestBytes(manifestBytes),
    manifest_start_line: rowIndex + 1,
    manifest_end_line: rowIndex + 1,
    closure_receipt_hash: receipt.receiptHash,
    candidate_hash: receipt.terminal.candidateDigest,
    gate_evidence_hash: receipt.terminal.gateEvidenceDigest,
    ...(receipt.operatingOriginCorrelation === null
      ? {}
      : { operating_origin: receipt.operatingOriginCorrelation }),
  };
}

export function buildShipClosureRunEvidence(receipt, marker, markerBytes) {
  return {
    manifest_hash: marker.manifest_hash,
    manifest_start_line: marker.manifest_start_line,
    manifest_end_line: marker.manifest_end_line,
    marker_hash: digestBytes(markerBytes),
    closure_receipt_hash: receipt.receiptHash,
    candidate_hash: receipt.terminal.candidateDigest,
    gate_evidence_hash: receipt.terminal.gateEvidenceDigest,
  };
}

export function buildShipClosureProvenanceEvent(
  receipt,
  { projectRoot, spec, marker, markerBytes } = {},
) {
  return createProvenanceEvent({
    projectRoot,
    artifactId: spec.frontmatter.id ?? `FEAT-${receipt.feature}`,
    artifactPath: spec.path,
    operation: 'shipped',
    product: 'planr-pipeline',
    version: pkg.version,
    runtime: receipt.runtime,
    phase: 'delivery',
    runId: receipt.runId,
    eventId: `ship-closure:${receipt.runId}`,
    timestamp: receipt.terminal.at,
    correlation: receipt.operatingOriginCorrelation,
    runEvidence: buildShipClosureRunEvidence(receipt, marker, markerBytes),
  });
}

function canonicalClosureProvenanceEvents(
  allReceipts,
  manifest,
  manifestBytes,
  spec,
  projectRoot,
  aggregate,
) {
  return allReceipts.map((terminalReceipt) => {
    const terminalRowIndex = manifest.findIndex(
      ({ stage }) => stage === `ship.closure:${terminalReceipt.runId}`,
    );
    const terminalMarker = buildShipClosureMarker(terminalReceipt, {
      manifestBytes,
      rowIndex: terminalRowIndex,
      aggregate,
    });
    const terminalMarkerBytes = renderShipClosureMarker(terminalMarker);
    const event = buildShipClosureProvenanceEvent(terminalReceipt, {
      projectRoot,
      spec,
      marker: terminalMarker,
      markerBytes: terminalMarkerBytes,
    });
    const errors = validateProtocolArtifact('provenance-event', event, {
      protocolVersion: '1.1.0',
    });
    if (errors.length) fail('E_PROVENANCE_INVALID', `${errors[0].path}: ${errors[0].detail}`);
    return event;
  });
}

function projectShipCompatibilityLocked(receipt, { projectRoot, prepared }) {
  const featureRoot = prepared.root;
  assertPathCustody(projectRoot, featureRoot, { expectedKind: 'directory' });
  assertPathCustody(projectRoot, join(projectRoot, '.planr'), { expectedKind: 'directory' });
  const manifestPath = join(featureRoot, '.run-manifest.jsonl');
  assertProjectionFile(manifestPath);
  const existingManifest = readManifest(manifestPath);
  const allReceipts = readAllTerminalReceipts(featureRoot, {
    projectRoot,
    feature: receipt.feature,
    mode: receipt.mode,
  }).sort(
    (left, right) =>
      left.terminal.at.localeCompare(right.terminal.at) || left.runId.localeCompare(right.runId),
  );
  const closureRows = allReceipts.map((terminalReceipt) =>
    buildShipClosureManifestRow(terminalReceipt, projectRoot, featureRoot),
  );
  for (const row of closureRows) {
    const errors = validateProtocolArtifact('run-manifest', row, { protocolVersion: '1.0.0' });
    if (errors.length) fail('E_RUN_MANIFEST_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  }
  const manifest = [
    ...existingManifest.filter(({ stage }) => !stage.startsWith('ship.closure:')),
    ...closureRows,
  ];
  const expectedManifestBytes = `${manifest.map((record) => JSON.stringify(record)).join('\n')}\n`;
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== expectedManifestBytes)
    atomicWrite(manifestPath, expectedManifestBytes);
  const stage = `ship.closure:${receipt.runId}`;
  const rowIndex = manifest.findIndex((record) => record.stage === stage);
  if (rowIndex === -1)
    fail(
      'E_SHIP_PROJECTION_CONFLICT',
      `Terminal receipt ${receipt.runId} is missing from the canonical manifest projection.`,
    );
  const statusProjection = projectStatuses(receipt, projectRoot, featureRoot);
  const projectionOwner = [...statusProjection.terminalReceipts]
    .sort(
      (left, right) =>
        left.terminal.at.localeCompare(right.terminal.at) || left.runId.localeCompare(right.runId),
    )
    .at(-1);
  const aggregate = aggregateProjection(statusProjection);
  const marker = buildShipClosureMarker(receipt, {
    manifestBytes: Buffer.from(expectedManifestBytes),
    rowIndex,
    aggregate,
  });
  const markerPath = join(featureRoot, '.pipeline-shipped');
  const qaReportPath = join(featureRoot, 'qa-report.md');
  assertProjectionFile(qaReportPath);
  const ownsLatestProjection = projectionOwner?.receiptHash === receipt.receiptHash;
  if (ownsLatestProjection)
    atomicWrite(qaReportPath, renderShipClosureQaReport(receipt, { aggregate }));
  const errors = validateProtocolArtifact('pipeline-shipped', marker, { protocolVersion: '1.0.0' });
  if (errors.length) fail('E_SHIPPED_MARKER_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  assertProjectionFile(markerPath);
  const markerBytes = renderShipClosureMarker(marker);
  if (ownsLatestProjection) atomicWrite(markerPath, markerBytes);
  const spec = statusProjection.spec;
  if (spec) {
    const provenancePath = join(projectRoot, '.planr', 'provenance.jsonl');
    assertProjectionFile(provenancePath);
    const provenance = existsSync(provenancePath)
      ? readFileSync(provenancePath, 'utf8')
          .split(/\r?\n/)
          .flatMap((line, index) => {
            if (!line) return [];
            let event;
            try {
              event = JSON.parse(line);
            } catch (error) {
              fail('E_PROVENANCE_INVALID', `${provenancePath}:${index + 1}: ${error.message}`);
            }
            const errors = validateProtocolArtifact('provenance-event', event, {
              protocolVersion: '1.1.0',
            });
            if (errors.length)
              fail(
                'E_PROVENANCE_INVALID',
                `${provenancePath}:${index + 1}: ${errors[0].path}: ${errors[0].detail}`,
              );
            return [event];
          })
      : [];
    const closureRunIds = new Set(allReceipts.map(({ runId }) => runId));
    const canonicalEvents = canonicalClosureProvenanceEvents(
      allReceipts,
      manifest,
      Buffer.from(expectedManifestBytes),
      spec,
      projectRoot,
      aggregate,
    );
    const canonicalProvenance = [
      ...provenance.filter(
        (event) => !(event.operation === 'shipped' && closureRunIds.has(event.run_id)),
      ),
      ...canonicalEvents,
    ];
    const provenanceBytes = `${canonicalProvenance.map((record) => JSON.stringify(record)).join('\n')}\n`;
    if (!existsSync(provenancePath) || readFileSync(provenancePath, 'utf8') !== provenanceBytes)
      atomicWrite(provenancePath, provenanceBytes);
  }
  return {
    markerPath,
    manifestPath,
    qaReportPath,
    marker: ownsLatestProjection ? marker : null,
    superseded: !ownsLatestProjection,
  };
}

export function verifyShipCompatibilityProjection(receipt, { projectRoot, prepared } = {}) {
  assertClosure(receipt);
  const featureRoot = prepared.root;
  assertPathCustody(projectRoot, featureRoot, { expectedKind: 'directory' });
  const manifestPath = join(featureRoot, '.run-manifest.jsonl');
  const qaReportPath = join(featureRoot, 'qa-report.md');
  const markerPath = join(featureRoot, '.pipeline-shipped');
  const provenancePath = join(projectRoot, '.planr', 'provenance.jsonl');
  try {
    assertProjectionFile(manifestPath, { allowMissing: false });
    assertProjectionFile(provenancePath, { allowMissing: false });
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const existingManifest = readManifest(manifestPath);
  const allReceipts = readAllTerminalReceipts(featureRoot, {
    projectRoot,
    feature: receipt.feature,
    mode: receipt.mode,
  }).sort(
    (left, right) =>
      left.terminal.at.localeCompare(right.terminal.at) || left.runId.localeCompare(right.runId),
  );
  const closureRows = allReceipts.map((terminalReceipt) =>
    buildShipClosureManifestRow(terminalReceipt, projectRoot, featureRoot),
  );
  const manifest = [
    ...existingManifest.filter(({ stage }) => !stage.startsWith('ship.closure:')),
    ...closureRows,
  ];
  const manifestBytes = `${manifest.map((record) => JSON.stringify(record)).join('\n')}\n`;
  if (readFileSync(manifestPath, 'utf8') !== manifestBytes) return false;
  const rowIndex = manifest.findIndex(({ stage }) => stage === `ship.closure:${receipt.runId}`);
  if (
    rowIndex === -1 ||
    manifest.filter(({ stage }) => stage === `ship.closure:${receipt.runId}`).length !== 1
  )
    return false;
  const specPath = walk(featureRoot, (name) =>
    receipt.mode === 'spec-driven' ? /^SPEC-.*\.md$/.test(name) : /^spec-.*\.md$/.test(name),
  )[0];
  if (!specPath) return false;
  const spec = artifact(specPath);
  const statusProjection = projectStatuses(receipt, projectRoot, featureRoot, { apply: false });
  if (!statusProjection.consistent) return false;
  const aggregate = aggregateProjection(statusProjection);
  let provenance;
  try {
    provenance = readFileSync(provenancePath, 'utf8')
      .split(/\r?\n/)
      .flatMap((line) => (line ? [JSON.parse(line)] : []));
  } catch {
    return false;
  }
  const closureRunIds = new Set(allReceipts.map(({ runId }) => runId));
  const canonicalEvents = canonicalClosureProvenanceEvents(
    allReceipts,
    manifest,
    Buffer.from(manifestBytes),
    spec,
    projectRoot,
    aggregate,
  );
  const expectedProvenance = [
    ...provenance.filter(
      (event) => !(event.operation === 'shipped' && closureRunIds.has(event.run_id)),
    ),
    ...canonicalEvents,
  ];
  if (
    `${expectedProvenance.map((record) => JSON.stringify(record)).join('\n')}\n` !==
    readFileSync(provenancePath, 'utf8')
  )
    return false;
  const leaves = terminalLeafReceipts(featureRoot, {
    projectRoot,
    feature: receipt.feature,
    mode: receipt.mode,
  });
  const owner = [...leaves]
    .sort(
      (left, right) =>
        left.terminal.at.localeCompare(right.terminal.at) || left.runId.localeCompare(right.runId),
    )
    .at(-1);
  const trustedRepositories = prepared.closureRepositories;
  if (!Array.isArray(trustedRepositories)) return false;
  const receiptRepositoryKeys = receipt.repositories.map(({ repositoryKey }) => repositoryKey);
  const trustedRepositoryKeys = trustedRepositories.map(({ repositoryKey }) => repositoryKey);
  if (JSON.stringify(receiptRepositoryKeys) !== JSON.stringify(trustedRepositoryKeys)) return false;
  const roots = new Map(
    trustedRepositories.map(({ repositoryKey, root }) => [repositoryKey, root]),
  );
  if (roots.size !== trustedRepositories.length) return false;
  if (owner?.receiptHash !== receipt.receiptHash) return true;
  try {
    const rehydrated = receipt.repositories.map((repository) => ({
      ...repository,
      root: roots.get(repository.repositoryKey),
    }));
    const candidate = receipt.candidateRevisions.at(-1);
    const live = captureCandidate(
      {
        ...receipt,
        repositories: rehydrated,
        candidateRevisions: receipt.candidateRevisions.slice(0, -1),
      },
      candidate.sealedAt,
    );
    if (live.digest !== candidate.digest) return false;
  } catch {
    return false;
  }
  try {
    assertProjectionFile(qaReportPath, { allowMissing: false });
    assertProjectionFile(markerPath, { allowMissing: false });
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  const marker = buildShipClosureMarker(receipt, {
    manifestBytes: Buffer.from(manifestBytes),
    rowIndex,
    aggregate,
  });
  return (
    readFileSync(qaReportPath, 'utf8') === renderShipClosureQaReport(receipt, { aggregate }) &&
    readFileSync(markerPath, 'utf8') === renderShipClosureMarker(marker)
  );
}

export function projectShipCompatibility(receipt, context) {
  const paths = closurePaths(context.prepared.root, receipt.runId, context.projectRoot);
  return withLock(paths.projectionLock, () => projectShipCompatibilityLocked(receipt, context));
}
