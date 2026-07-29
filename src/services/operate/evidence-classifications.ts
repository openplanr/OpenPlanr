import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { canonicalDigest, canonicalize } from './canonical.js';
import {
  listEvidenceDiagnostics,
  readEvidenceDiagnostic,
  writeEvidenceDiagnostic,
} from './evidence-diagnostics.js';
import { createOperatingAction } from './interaction/action-service.js';
import { assertOperatingConfirmation } from './interaction/confirmation-service.js';
import { currentGuidedSessionBindings } from './interaction/session-service.js';
import { redactSensitiveText } from './redaction.js';
import { OperateError } from './types.js';
import { resolveOperatingPaths } from './workspace.js';

const HARD_BLOCK_CATEGORIES = new Set([
  'known-token',
  'private-key',
  'jwt',
  'authorization',
  'credential-url',
]);

export async function classifyEvidenceDiagnostic(input: {
  projectRoot: string;
  candidateId: string;
  status: 'false-positive' | 'confirmed-secret';
  reason: string;
  classifiedBy: string;
  confirmationDigest?: string;
  confirmed: boolean;
  localRoot?: string;
  now?: Date;
}) {
  const diagnostic = await readEvidenceDiagnostic(input);
  const bindings = await currentGuidedSessionBindings(input.projectRoot);
  if (bindings.projectHead !== diagnostic.projectHead) {
    throw new OperateError(
      'E_OPERATE_ROUTE_DRIFT',
      'The project head changed after evidence diagnosis.',
      { changedDimensions: ['projectHead'], candidateId: diagnostic.candidateId },
    );
  }
  if (input.status === 'false-positive' && HARD_BLOCK_CATEGORIES.has(diagnostic.category)) {
    throw new OperateError(
      'E_OPERATE_SECRET_DETECTED',
      'Known credential, authorization, private-key, JWT, and credential-URL signatures cannot be classified as false positives.',
      {
        candidateId: diagnostic.candidateId,
        ruleId: diagnostic.ruleId,
        category: diagnostic.category,
        valueDisclosed: false,
      },
    );
  }
  const reason = input.reason.replace(/\s+/g, ' ').trim();
  if (!reason || reason.length > 1_000) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Evidence classification requires a bounded reason.',
    );
  }
  const sanitizedReason = redactSensitiveText(reason);
  if (sanitizedReason.redactions.length > 0) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Evidence classification reasons cannot contain sensitive material.',
    );
  }
  const created = await createOperatingAction({
    id: 'operate.evidence.classify',
    label:
      input.status === 'false-positive'
        ? 'Classify this exact candidate as a false positive'
        : 'Confirm that this candidate requires source remediation',
    command: `planr operate evidence classify ${diagnostic.candidateId}`,
    effect: 'machine-local-write',
    confirmation: {
      sessionId: `GIS-evidence-${diagnostic.candidateId.slice('EVC-'.length)}`,
      confirmationScope: `operate.evidence.classify:${diagnostic.candidateId}:${input.status}`,
      projectIdentity: bindings.projectIdentity,
      projectHead: bindings.projectHead,
      configHead: bindings.configHead,
      eventHead: null,
      arguments: [
        input.status,
        canonicalDigest(reason),
        diagnostic.ruleId,
        diagnostic.contentDigest,
      ],
      destinations: [],
      writes: [`evidence-diagnostics/${diagnostic.candidateId}.json`],
    },
  });
  if (!input.confirmed || !input.confirmationDigest || !created.confirmation) {
    return {
      state: 'preview',
      candidateId: diagnostic.candidateId,
      action: created.action,
      confirmation: created.confirmation,
      valueDisclosed: false,
    };
  }
  const accepted = assertOperatingConfirmation({
    expected: created.confirmation,
    actionId: created.action.id,
    confirmationDigest: input.confirmationDigest,
    confirmed: input.confirmed,
    now: input.now,
  });
  const classifiedAt = (input.now ?? new Date()).toISOString();
  const next = {
    ...diagnostic,
    classification: {
      status: input.status,
      ruleId: diagnostic.ruleId,
      contentDigest: diagnostic.contentDigest,
      projectHead: diagnostic.projectHead,
      reason,
      confirmationDigest: accepted.confirmationDigest,
      classifiedAt,
      classifiedBy: input.classifiedBy,
    },
  };
  await writeEvidenceDiagnostic({ ...input, diagnostic: next });
  const auditPath = path.join(
    resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot }).quarantine,
    'classification-audit.jsonl',
  );
  await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  await appendFile(
    auditPath,
    `${canonicalize({
      candidateId: diagnostic.candidateId,
      status: input.status,
      ruleId: diagnostic.ruleId,
      contentDigest: diagnostic.contentDigest,
      projectHead: diagnostic.projectHead,
      reasonDigest: canonicalDigest(reason),
      confirmationDigest: accepted.confirmationDigest,
      classifiedAt,
      classifiedBy: input.classifiedBy,
      valueDisclosed: false,
    })}\n`,
    { mode: 0o600 },
  );
  return { state: 'classified', diagnostic: next };
}

export async function purgeStaleEvidenceClassifications(input: {
  projectRoot: string;
  localRoot?: string;
  purge?: boolean;
}): Promise<{ stale: number; purged: number }> {
  const bindings = await currentGuidedSessionBindings(input.projectRoot);
  const diagnostics = await listEvidenceDiagnostics(input);
  let stale = 0;
  let purged = 0;
  for (const diagnostic of diagnostics) {
    if (!diagnostic.classification || diagnostic.projectHead === bindings.projectHead) continue;
    stale += 1;
    if (!input.purge) continue;
    const { classification: _classification, ...current } = diagnostic;
    await writeEvidenceDiagnostic({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      diagnostic: current,
    });
    purged += 1;
  }
  return { stale, purged };
}
