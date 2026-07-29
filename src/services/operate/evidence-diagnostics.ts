import { chmod, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveGuidedInteractionValidators } from '../pipeline-package-service.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { createOperatingAction } from './interaction/action-service.js';
import { currentGuidedSessionBindings } from './interaction/session-service.js';
import type { SecretDetectionMetadata } from './redaction.js';
import { type CollectedEvidenceItem, type EvidenceDiagnostic, OperateError } from './types.js';
import { resolveOperatingPaths } from './workspace.js';

const CANDIDATE_ID = /^EVC-[A-Za-z0-9._-]{8,128}$/;

function diagnosticDirectory(projectRoot: string, localRoot?: string): string {
  return path.join(resolveOperatingPaths(projectRoot, { localRoot }).quarantine, 'diagnostics');
}

function diagnosticPath(projectRoot: string, candidateId: string, localRoot?: string): string {
  if (!CANDIDATE_ID.test(candidateId)) {
    throw new OperateError('E_OPERATE_CONFIG_INVALID', 'Evidence candidate ID is invalid.');
  }
  return path.join(diagnosticDirectory(projectRoot, localRoot), `${candidateId}.json`);
}

function diagnosticSource(item: CollectedEvidenceItem): EvidenceDiagnostic['source'] {
  if (item.source === 'file-import') {
    return item.location.toLowerCase().endsWith('.csv') ? 'import-csv' : 'import-json';
  }
  if (['repository', 'planr', 'git', 'github', 'linear'].includes(item.source)) {
    return item.source as EvidenceDiagnostic['source'];
  }
  return 'repository';
}

function safeLocation(item: CollectedEvidenceItem): string | undefined {
  const value = item.location.replaceAll('\\', '/').trim();
  if (
    !value ||
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:\//.test(value) ||
    value.split('/').includes('..') ||
    /(?:\/Users\/|\/home\/|[A-Za-z]:\/Users\/)/i.test(value)
  ) {
    return undefined;
  }
  return value.slice(0, 4_096);
}

async function atomicDiagnosticWrite(
  projectRoot: string,
  diagnostic: EvidenceDiagnostic,
  localRoot?: string,
): Promise<void> {
  const validators = await resolveGuidedInteractionValidators();
  if (validators.validateEvidenceDiagnostic(diagnostic).length > 0) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Evidence diagnostic ${diagnostic.candidateId} failed Protocol v1.2 validation.`,
    );
  }
  const target = diagnosticPath(projectRoot, diagnostic.candidateId, localRoot);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${canonicalize(diagnostic)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  await chmod(target, 0o600);
}

export async function createEvidenceDiagnostic(input: {
  projectRoot: string;
  item: CollectedEvidenceItem;
  detection: SecretDetectionMetadata;
  localRoot?: string;
}): Promise<EvidenceDiagnostic> {
  const bindings = await currentGuidedSessionBindings(input.projectRoot);
  const contentDigest = sha256Digest(input.item.content);
  const candidateId = `EVC-${canonicalDigest({
    source: input.item.source,
    componentId: input.item.repository?.componentId ?? 'control',
    location: input.item.location,
    line: input.detection.line,
    ruleId: input.detection.ruleId,
    contentDigest,
    projectHead: bindings.projectHead,
  }).slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const componentId = input.item.repository?.componentId ?? 'control';
  const diagnose = await createOperatingAction({
    id: 'operate.evidence.diagnose',
    label: 'Inspect the safe evidence diagnostic',
    command: `planr operate evidence diagnose ${candidateId}`,
    effect: 'read-only',
    recommended: true,
  });
  const classify = await createOperatingAction({
    id: 'operate.evidence.classify',
    label: 'Review an eligible exact false-positive classification',
    command: `planr operate evidence classify ${candidateId}`,
    effect: 'machine-local-write',
    confirmation: {
      sessionId: `GIS-evidence-${candidateId.slice('EVC-'.length)}`,
      confirmationScope: `operate.evidence.classify:${candidateId}`,
      projectIdentity: bindings.projectIdentity,
      projectHead: bindings.projectHead,
      configHead: bindings.configHead,
      eventHead: null,
      arguments: [
        input.detection.ruleId,
        contentDigest,
        canonicalDigest({ location: safeLocation(input.item) ?? null }),
      ],
      destinations: [],
      writes: [`evidence-diagnostics/${candidateId}.json`],
    },
  });
  const diagnostic: EvidenceDiagnostic = {
    kind: 'evidence-diagnostic',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    candidateId,
    source: diagnosticSource(input.item),
    componentId,
    ...(safeLocation(input.item) ? { location: safeLocation(input.item) } : {}),
    ...(Number.isInteger(input.detection.line) ? { line: input.detection.line } : {}),
    ruleId: input.detection.ruleId,
    category: input.detection.category,
    contentDigest,
    projectHead: bindings.projectHead,
    valueDisclosed: false,
    actions: [diagnose.action, classify.action],
  };
  const existing = await readEvidenceDiagnostic({
    projectRoot: input.projectRoot,
    candidateId,
    localRoot: input.localRoot,
  }).catch(() => null);
  if (
    existing &&
    existing.ruleId === diagnostic.ruleId &&
    existing.contentDigest === diagnostic.contentDigest &&
    existing.projectHead === diagnostic.projectHead
  ) {
    return existing;
  }
  await atomicDiagnosticWrite(input.projectRoot, diagnostic, input.localRoot);
  return diagnostic;
}

export async function readEvidenceDiagnostic(input: {
  projectRoot: string;
  candidateId: string;
  localRoot?: string;
}): Promise<EvidenceDiagnostic> {
  const target = diagnosticPath(input.projectRoot, input.candidateId, input.localRoot);
  try {
    const diagnostic = JSON.parse(await readFile(target, 'utf8')) as EvidenceDiagnostic;
    const validators = await resolveGuidedInteractionValidators();
    if (validators.validateEvidenceDiagnostic(diagnostic).length > 0) throw new Error('invalid');
    return diagnostic;
  } catch {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Evidence diagnostic ${input.candidateId} is unavailable or invalid.`,
    );
  }
}

export async function listEvidenceDiagnostics(input: {
  projectRoot: string;
  localRoot?: string;
}): Promise<EvidenceDiagnostic[]> {
  const directory = diagnosticDirectory(input.projectRoot, input.localRoot);
  const names = (await readdir(directory).catch(() => []))
    .filter((name) => /^EVC-[A-Za-z0-9._-]+\.json$/.test(name))
    .sort();
  const diagnostics: EvidenceDiagnostic[] = [];
  for (const name of names) {
    diagnostics.push(
      await readEvidenceDiagnostic({
        ...input,
        candidateId: name.slice(0, -'.json'.length),
      }),
    );
  }
  return diagnostics;
}

export async function writeEvidenceDiagnostic(input: {
  projectRoot: string;
  diagnostic: EvidenceDiagnostic;
  localRoot?: string;
}): Promise<void> {
  await atomicDiagnosticWrite(input.projectRoot, input.diagnostic, input.localRoot);
}
