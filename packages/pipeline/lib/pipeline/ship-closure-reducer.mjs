import { createHash } from 'node:crypto';

import { validateProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { assertBrowserQaGateRecord, assertBrowserQaRecordedEventAuthority } from './browser-qa.mjs';
import { PipelineError } from './errors.mjs';
import {
  candidateCorrectionPaths,
  normalizeRepositoryPath,
  pathsIntersect,
  repositoryMap,
} from './ship-closure-identity.mjs';
import { assertShipRiskClassification } from './ship-risk.mjs';

const TERMINAL_STATES = new Set(['passed', 'blocked']);
const EVENT_KEYS = Object.freeze({
  'task.completed': [
    'type',
    'expectedGeneration',
    'taskId',
    'agent',
    'filesWritten',
    'filesModified',
  ],
  'task.blocked': [
    'type',
    'expectedGeneration',
    'taskId',
    'agent',
    'reason',
    'filesWritten',
    'filesModified',
  ],
  'review.opened': ['type', 'expectedGeneration'],
  'review.closed': [
    'type',
    'expectedGeneration',
    'phase',
    'candidateRevision',
    'candidateDigest',
    'reviewerIds',
    'contributions',
    'findings',
    'reviewedFindingIds',
    'summary',
    'rosterDigest',
    'gateSetDigest',
  ],
  'correction.registered': ['type', 'expectedGeneration', 'impact'],
  'browser-qa.recorded': ['type', 'expectedGeneration', 'record'],
});
const FINDING_KEYS = Object.freeze([
  'id',
  'severity',
  'basis',
  'title',
  'evidence',
  'taskIds',
  'paths',
  'acceptanceRefs',
  'disposition',
]);

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function clone(value) {
  return structuredClone(value);
}

function digestBytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function compareCanonical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRepositoryPath(left, right) {
  return (
    compareCanonical(left.repositoryKey, right.repositoryKey) ||
    compareCanonical(left.path, right.path)
  );
}

function exactKeys(value, expected, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('E_SHIP_EVENT_INVALID', `${subject} must be a closed JSON object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail('E_SHIP_EVENT_INVALID', `${subject} fields must be exactly: ${wanted.join(', ')}.`);
  }
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
  );
}

function assertAcyclic(records, label) {
  const resolved = new Set();
  while (resolved.size < records.length) {
    const ready = records.filter(
      ({ id, dependsOn }) =>
        !resolved.has(id) && dependsOn.every((dependency) => resolved.has(dependency)),
    );
    if (ready.length === 0) fail('E_SHIP_CLOSURE_INVALID', `${label} dependency graph is cyclic.`);
    ready.forEach(({ id }) => resolved.add(id));
  }
}

function assertLogicalPath(path, label) {
  if (
    typeof path !== 'string' ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:\//.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail('E_SHIP_CLOSURE_INVALID', `${label} must be one normalized repository-relative path.`);
  }
}

function assertCanonicalRepositoryPath(entry, label, { allowRoot = false } = {}) {
  let normalized;
  try {
    normalized = normalizeRepositoryPath(entry, label, { allowRoot });
  } catch (error) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      `${label} is not a canonical repository-relative path: ${error.message}`,
    );
  }
  if (normalized.repositoryKey !== entry.repositoryKey || normalized.path !== entry.path) {
    fail('E_SHIP_CLOSURE_INVALID', `${label} is not in canonical repository-relative form.`);
  }
  return normalized;
}

function validateContributions(contributions, reviewerRoster) {
  if (!Array.isArray(contributions) || contributions.length !== reviewerRoster.length) {
    fail(
      'E_SHIP_REVIEWER_UNDECLARED',
      'The consolidated review requires one bounded contribution from every frozen reviewer.',
    );
  }
  for (const contribution of contributions) {
    exactKeys(
      contribution,
      ['reviewerId', 'summary', 'evidenceDigest'],
      `review contribution ${contribution?.reviewerId ?? '<unknown>'}`,
    );
    if (!reviewerRoster.includes(contribution.reviewerId))
      fail(
        'E_SHIP_REVIEWER_UNDECLARED',
        `Reviewer ${contribution.reviewerId} is not in the frozen roster.`,
      );
    if (typeof contribution.summary !== 'string' || contribution.summary.trim().length === 0)
      fail(
        'E_SHIP_REVIEW_INVALID',
        `Reviewer ${contribution.reviewerId} contribution requires a nonblank summary.`,
      );
    if (!/^sha256:[a-f0-9]{64}$/.test(contribution.evidenceDigest ?? ''))
      fail(
        'E_SHIP_REVIEW_INVALID',
        `Reviewer ${contribution.reviewerId} contribution requires a SHA-256 evidence digest.`,
      );
  }
  const contributors = contributions.map(({ reviewerId }) => reviewerId);
  if (!sameMembers(contributors, reviewerRoster))
    fail(
      'E_SHIP_REVIEWER_UNDECLARED',
      'Review contributions must cover the exact frozen roster once each.',
    );
  return contributions;
}

export function assertClosure(value, { allowTargetedClosing = false } = {}) {
  const errors = validateProtocolArtifact('ship-closure', value, { protocolVersion: '1.1.0' });
  if (errors.length) fail('E_SHIP_CLOSURE_INVALID', `${errors[0].path}: ${errors[0].detail}`);
  if (
    value.reviewerRoster[0] !== 'qa-agent' ||
    value.reviewerRoster.filter((reviewerId) => reviewerId === 'qa-agent').length !== 1
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'The frozen reviewer roster must contain qa-agent exactly once in the first position.',
    );
  }
  const hasPlanningReview = Object.hasOwn(value, 'planningReview');
  const hasRisk = Object.hasOwn(value, 'riskClassification');
  const hasBrowserRecords = Object.hasOwn(value, 'browserQaRecords');
  if (
    (value.schemaVersion !== '1.0.0') !== hasPlanningReview ||
    (value.schemaVersion === '1.2.0') !== hasRisk ||
    (value.schemaVersion === '1.2.0') !== hasBrowserRecords
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'SHIP schema versions require exact planning-review and adaptive-review custody; legacy records must omit newer fields.',
    );
  }
  if (hasRisk) {
    assertShipRiskClassification(value.riskClassification);
    if (
      JSON.stringify(value.reviewerRoster) !==
      JSON.stringify(value.riskClassification.reviewerRoster)
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Frozen reviewer roster does not equal the deterministic risk classification.',
      );
    }
    const browserGates = value.gates.filter(({ gateType }) => gateType === 'browser-qa');
    if (browserGates.length !== (value.riskClassification.browserQa.required ? 1 : 0)) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Frozen browser gate does not equal the deterministic browser requirement.',
      );
    }
    const records = value.browserQaRecords;
    if (
      new Set(records.map(({ candidateRevision }) => candidateRevision)).size !== records.length
    ) {
      fail('E_SHIP_CLOSURE_INVALID', 'Browser QA records must be unique per candidate revision.');
    }
    for (const record of records) {
      assertBrowserQaGateRecord(record);
      const candidate = value.candidateRevisions.find(
        ({ revision }) => revision === record.candidateRevision,
      );
      if (
        !candidate ||
        candidate.digest !== record.candidateDigest ||
        record.requirementDigest !== value.riskClassification.browserQa.requirementDigest ||
        record.required !== value.riskClassification.browserQa.required
      ) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          'Browser QA record is foreign to the frozen candidate or requirement.',
        );
      }
    }
  }
  if ((value.startedFromReceiptHash === null) !== (value.reopenReason === null)) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Reopen custody requires both a prior receipt hash and a nonblank owner reason, or neither.',
    );
  }
  if (value.rosterDigest !== sha256Jcs(value.reviewerRoster))
    fail('E_SHIP_CLOSURE_INVALID', 'rosterDigest does not bind reviewerRoster.');
  if (value.gateSetDigest !== sha256Jcs(value.gates))
    fail('E_SHIP_CLOSURE_INVALID', 'gateSetDigest does not bind gates.');
  if (new Set(value.tasks.map(({ id }) => id)).size !== value.tasks.length)
    fail('E_SHIP_CLOSURE_INVALID', 'Task IDs must be unique.');
  const taskIds = new Set(value.tasks.map(({ id }) => id));
  if (
    value.tasks.some(
      ({ id, dependsOn }) =>
        dependsOn.includes(id) || dependsOn.some((dependency) => !taskIds.has(dependency)),
    )
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Task dependencies must reference distinct tasks in the frozen scope.',
    );
  }
  assertAcyclic(value.tasks, 'Task');
  assertLogicalPath(value.approvedScope.featureRoot, 'approvedScope.featureRoot');
  const approvedScopeIdentity = {
    featureRoot: value.approvedScope.featureRoot,
    tasks: value.tasks.map(({ id, storyId, path, dependsOn, preserve }) => ({
      id,
      storyId,
      path,
      dependsOn,
      preserve: preserve.map(({ identity, ...entry }) => entry),
    })),
  };
  if (
    value.approvedScope.digest !== sha256Jcs(approvedScopeIdentity) ||
    JSON.stringify(value.approvedScope.taskIds) !== JSON.stringify(value.tasks.map(({ id }) => id))
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'approvedScope does not bind the exact ordered task DAG and structured Preserve declarations.',
    );
  }
  const frozenRepositoryOrder = value.repositories.map(({ repositoryKey }) => repositoryKey);
  if (new Set(frozenRepositoryOrder).size !== value.repositories.length)
    fail('E_SHIP_CLOSURE_INVALID', 'Repository keys must be unique.');
  if (JSON.stringify(frozenRepositoryOrder) !== JSON.stringify([...frozenRepositoryOrder].sort())) {
    fail('E_SHIP_CLOSURE_INVALID', 'Frozen repositories must use canonical repository-key order.');
  }
  const repositoryKeys = new Set(value.repositories.map(({ repositoryKey }) => repositoryKey));
  for (const task of value.tasks) {
    assertCanonicalRepositoryPath(task.path, `task ${task.id} path`);
    task.preserve.forEach((entry) =>
      assertCanonicalRepositoryPath(
        { repositoryKey: entry.repositoryKey, path: entry.path },
        `task ${task.id} Preserve path`,
      ),
    );
    task.filesWritten.forEach((entry) =>
      assertCanonicalRepositoryPath(entry, `task ${task.id} filesWritten path`),
    );
    task.filesModified.forEach((entry) =>
      assertCanonicalRepositoryPath(entry, `task ${task.id} filesModified path`),
    );
    if (
      !repositoryKeys.has(task.path.repositoryKey) ||
      [...task.preserve, ...task.filesWritten, ...task.filesModified].some(
        ({ repositoryKey }) => !repositoryKeys.has(repositoryKey),
      )
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Task ${task.id} references a repository outside the frozen set.`,
      );
    }
  }
  if (new Set(value.gates.map(({ id }) => id)).size !== value.gates.length)
    fail('E_SHIP_CLOSURE_INVALID', 'Gate IDs must be unique.');
  const gateIds = new Set(value.gates.map(({ id }) => id));
  if (
    value.gates.filter(({ finalRelevantSuite }) => finalRelevantSuite).length !== 1 ||
    value.gates.some(
      ({ id, dependsOn }) =>
        dependsOn.includes(id) || dependsOn.some((dependency) => !gateIds.has(dependency)),
    )
  ) {
    fail('E_SHIP_CLOSURE_INVALID', 'Frozen gates require one final suite and valid dependencies.');
  }
  assertAcyclic(value.gates, 'Gate');
  value.gates.forEach((gate) =>
    gate.inputs.forEach((entry) =>
      assertCanonicalRepositoryPath(entry, `gate ${gate.id} input`, { allowRoot: true }),
    ),
  );
  if (
    value.gates.some(
      (gate) =>
        !repositoryKeys.has(gate.repositoryKey) ||
        gate.inputs.some(({ repositoryKey }) => !repositoryKeys.has(repositoryKey)),
    )
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Frozen gates and bounded inputs must use declared repositories.',
    );
  }
  if (new Set(value.events.map(({ eventId }) => eventId)).size !== value.events.length)
    fail('E_SHIP_CLOSURE_INVALID', 'Event IDs must be unique.');
  if (value.candidateRevisions.some((candidate, index) => candidate.revision !== index + 1)) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Candidate revisions must be contiguous from one and never exceed two.',
    );
  }
  for (const candidate of value.candidateRevisions) {
    const candidateRepositoryKeys = candidate.repositories.map(
      ({ repositoryKey }) => repositoryKey,
    );
    if (JSON.stringify(candidateRepositoryKeys) !== JSON.stringify(frozenRepositoryOrder)) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Candidate revision ${candidate.revision} must bind every frozen repository exactly once in canonical order.`,
      );
    }
    const inventoryKeys = candidate.inventory.map(({ repositoryKey, path }) =>
      JSON.stringify([repositoryKey, path]),
    );
    if (
      new Set(inventoryKeys).size !== inventoryKeys.length ||
      candidate.inventory.some(({ repositoryKey }) => !repositoryKeys.has(repositoryKey))
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Candidate revision ${candidate.revision} inventory has duplicate or foreign paths.`,
      );
    }
    const canonicalInventoryKeys = [...candidate.inventory]
      .sort(compareRepositoryPath)
      .map(({ repositoryKey, path }) => JSON.stringify([repositoryKey, path]));
    if (JSON.stringify(inventoryKeys) !== JSON.stringify(canonicalInventoryKeys)) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Candidate revision ${candidate.revision} inventory is not in canonical repository/path order.`,
      );
    }
    for (const entry of candidate.inventory) {
      assertLogicalPath(entry.path, `candidate revision ${candidate.revision} inventory path`);
      const normalized = normalizeRepositoryPath(
        { repositoryKey: entry.repositoryKey, path: entry.path },
        `candidate revision ${candidate.revision} inventory path`,
      );
      if (normalized.path !== entry.path)
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Candidate revision ${candidate.revision} contains a noncanonical inventory path.`,
        );
      if (entry.originalPath !== null) {
        assertLogicalPath(
          entry.originalPath,
          `candidate revision ${candidate.revision} original path`,
        );
        const original = normalizeRepositoryPath(
          { repositoryKey: entry.repositoryKey, path: entry.originalPath },
          `candidate revision ${candidate.revision} original path`,
        );
        if (original.path !== entry.originalPath || entry.originalPath === entry.path)
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Candidate revision ${candidate.revision} contains a noncanonical rename origin.`,
          );
      }
      const renamed = entry.changeType === 'renamed';
      if (renamed !== (entry.originalPath !== null))
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Candidate revision ${candidate.revision} has inconsistent rename custody for ${entry.path}.`,
        );
      if (entry.changeType === 'deleted') {
        if (
          entry.kind !== 'missing' ||
          entry.mode !== null ||
          entry.contentDigest !== null ||
          entry.symlinkTarget !== null ||
          entry.originalPath !== null
        ) {
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Deleted inventory entry ${entry.path} must be an exact missing-node record.`,
          );
        }
      } else {
        if (
          entry.kind === 'missing' ||
          !Number.isSafeInteger(entry.mode) ||
          entry.mode < 0 ||
          entry.mode > 0o7777 ||
          entry.contentDigest === null
        ) {
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Live inventory entry ${entry.path} has invalid kind, mode, or content custody.`,
          );
        }
        if ((entry.kind === 'symlink') !== (typeof entry.symlinkTarget === 'string')) {
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Inventory entry ${entry.path} has inconsistent symlink custody.`,
          );
        }
        if (
          entry.kind === 'symlink' &&
          entry.contentDigest !== digestBytes(Buffer.from(entry.symlinkTarget, 'utf8'))
        ) {
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Symlink inventory entry ${entry.path} does not bind its exact target bytes.`,
          );
        }
      }
    }
    if (
      candidate.digest !==
      sha256Jcs({ repositories: candidate.repositories, inventory: candidate.inventory })
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Candidate revision ${candidate.revision} digest does not bind its repository inventory.`,
      );
    }
    for (const repository of candidate.repositories) {
      const entries = candidate.inventory.filter(
        ({ repositoryKey }) => repositoryKey === repository.repositoryKey,
      );
      if (repository.inventoryDigest !== sha256Jcs(entries))
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Candidate repository ${repository.repositoryKey} inventoryDigest is invalid.`,
        );
      if (
        !value.repositories.some(
          (frozen) =>
            frozen.repositoryKey === repository.repositoryKey &&
            frozen.head === repository.head &&
            frozen.baselineDigest === repository.baselineDigest,
        )
      ) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Candidate repository ${repository.repositoryKey} does not bind the frozen baseline.`,
        );
      }
    }
  }
  for (const [index, review] of value.reviews.entries()) {
    const expectedRevision = index + 1;
    if (review.candidateRevision !== expectedRevision) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `${review.phase} review must bind candidate revision ${expectedRevision}.`,
      );
    }
    const candidate = value.candidateRevisions.find(
      ({ revision }) => revision === review.candidateRevision,
    );
    if (
      !candidate ||
      candidate.digest !== review.candidateDigest ||
      review.rosterDigest !== value.rosterDigest ||
      review.gateSetDigest !== value.gateSetDigest
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Review phase ${review.phase} does not bind candidate, roster, and gates.`,
      );
    }
    if (!sameMembers(review.reviewerIds, value.reviewerRoster)) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Review phase ${review.phase} does not cover the exact frozen roster.`,
      );
    }
    validateContributions(review.contributions, value.reviewerRoster);
    const initialFindingIds = new Set(value.reviews[0]?.findings.map(({ id }) => id) ?? []);
    for (const [findingIndex, finding] of review.findings.entries()) {
      validateFinding(clone(finding), value);
      const runtimeOwned = index === 0 || !initialFindingIds.has(finding.id);
      if (runtimeOwned) {
        const expectedId = runtimeFindingId(value, review, { ...finding, id: null }, findingIndex);
        if (finding.id !== expectedId)
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Finding ${finding.id} does not match its deterministic runtime identity.`,
          );
      }
    }
    if (new Set(review.findings.map(({ id }) => id)).size !== review.findings.length)
      fail('E_SHIP_CLOSURE_INVALID', `Review phase ${review.phase} has duplicate finding IDs.`);
    if (review.phase !== (index === 0 ? 'initial' : 'targeted'))
      fail('E_SHIP_CLOSURE_INVALID', 'Review phases must be ordered initial then targeted.');
    const reviewEvidence = value.gateEvidence.filter(({ phase }) => phase === review.phase);
    if (reviewEvidence.length !== value.gates.length) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `${review.phase} review requires the complete frozen phase-gate batch.`,
      );
    }
    if (blockingFindings(review).length === 0) {
      if (reviewEvidence.some(({ status }) => !['passed', 'reused'].includes(status))) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Clean ${review.phase} review requires complete passing phase-gate evidence.`,
        );
      }
    }
  }
  if (
    value.reviews[0]?.findings.some(({ severity, disposition }) =>
      ['P0', 'P1'].includes(severity)
        ? disposition !== 'open'
        : !['deferred', 'resolved'].includes(disposition),
    )
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Initial review dispositions violate blocking/non-blocking policy.',
    );
  }
  if (value.reviews[1]) {
    const required = blockingFindings(value.reviews[0])
      .map(({ id }) => id)
      .sort();
    if (!sameMembers(value.reviews[1].reviewedFindingIds, required))
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Targeted review does not account for the exact initial blocking batch.',
      );
    for (const id of required) {
      const original = value.reviews[0].findings.find((finding) => finding.id === id);
      const adjudication = value.reviews[1].findings.find((finding) => finding.id === id);
      if (!adjudication || !['resolved', 'remains'].includes(adjudication.disposition))
        fail('E_SHIP_CLOSURE_INVALID', `Targeted review omitted disposition for ${id}.`);
      for (const field of ['severity', 'basis', 'title', 'taskIds', 'paths', 'acceptanceRefs']) {
        if (sha256Jcs(original[field]) !== sha256Jcs(adjudication[field]))
          fail('E_SHIP_CLOSURE_INVALID', `Targeted review changed ${field} custody for ${id}.`);
      }
    }
    for (const finding of value.reviews[1].findings.filter(({ id }) => !required.includes(id))) {
      if (
        ['P0', 'P1'].includes(finding.severity) &&
        !['open', 'remains'].includes(finding.disposition)
      ) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `New targeted blocker ${finding.id} cannot be self-resolved.`,
        );
      }
      if (finding.severity === 'P2' && !['deferred', 'resolved'].includes(finding.disposition))
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Targeted P2 finding ${finding.id} has a blocking disposition.`,
        );
    }
  } else if (value.reviews[0]?.reviewedFindingIds.length) {
    fail('E_SHIP_CLOSURE_INVALID', 'Initial review cannot claim reviewed findings.');
  }
  const evidenceKeys = value.gateEvidence.map(
    ({ gateId, phase, candidateDigest }) => `${phase}:${candidateDigest}:${gateId}`,
  );
  if (new Set(evidenceKeys).size !== evidenceKeys.length)
    fail('E_SHIP_CLOSURE_INVALID', 'Gate evidence must be unique per phase, candidate, and gate.');
  for (const evidence of value.gateEvidence) {
    if (
      !gateIds.has(evidence.gateId) ||
      !value.candidateRevisions.some(({ digest }) => digest === evidence.candidateDigest)
    ) {
      fail('E_SHIP_CLOSURE_INVALID', `Gate evidence ${evidence.gateId} has foreign custody.`);
    }
    const expectedCandidate =
      evidence.phase === 'initial'
        ? value.candidateRevisions[0]
        : evidence.phase === 'targeted'
          ? value.candidateRevisions[1]
          : value.candidateRevisions.at(-1);
    if (!expectedCandidate || evidence.candidateDigest !== expectedCandidate.digest)
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Gate evidence ${evidence.gateId} is attached to the wrong ${evidence.phase} candidate.`,
      );
    if (Date.parse(evidence.startedAt) > Date.parse(evidence.endedAt))
      fail('E_SHIP_CLOSURE_INVALID', `Gate evidence ${evidence.gateId} ends before it starts.`);
    if (['passed', 'reused'].includes(evidence.status) && evidence.exitCode !== 0) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Passing gate evidence ${evidence.gateId} must carry exit code zero.`,
      );
    }
    if (evidence.status === 'failed' && evidence.exitCode === 0)
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Failed gate evidence ${evidence.gateId} cannot carry exit code zero.`,
      );
    if (
      evidence.status === 'skipped' &&
      (evidence.exitCode !== null ||
        evidence.stdoutDigest !== digestBytes(Buffer.alloc(0)) ||
        evidence.stderrDigest !== digestBytes(Buffer.alloc(0)) ||
        evidence.stdoutExcerpt !== '' ||
        evidence.stderrExcerpt !== '')
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Skipped gate evidence ${evidence.gateId} must carry an exact empty diagnostic record.`,
      );
    }
    if ((evidence.status === 'reused') !== (evidence.reusedFromPhase !== null))
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Gate evidence ${evidence.gateId} has inconsistent reuse custody.`,
      );
    const gate = value.gates.find(({ id }) => id === evidence.gateId);
    if (evidence.phase === 'final' && gate.finalRelevantSuite && evidence.status === 'reused')
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'The mandatory final relevant suite cannot reuse earlier evidence.',
      );
    if (evidence.status === 'reused') {
      const phaseOrder = ['initial', 'targeted', 'final'];
      if (phaseOrder.indexOf(evidence.reusedFromPhase) >= phaseOrder.indexOf(evidence.phase)) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Gate evidence ${evidence.gateId} cannot reuse evidence from the same or a later phase.`,
        );
      }
      const source = value.gateEvidence.find(
        (entry) =>
          entry.gateId === evidence.gateId &&
          entry.phase === evidence.reusedFromPhase &&
          entry.inputDigest === evidence.inputDigest &&
          ['passed', 'reused'].includes(entry.status),
      );
      if (!source)
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Gate evidence ${evidence.gateId} does not identify matching earlier passing evidence.`,
        );
      for (const field of [
        'exitCode',
        'stdoutDigest',
        'stderrDigest',
        'stdoutExcerpt',
        'stderrExcerpt',
      ]) {
        if (sha256Jcs(evidence[field]) !== sha256Jcs(source[field])) {
          fail(
            'E_SHIP_CLOSURE_INVALID',
            `Reused gate evidence ${evidence.gateId} changed ${field} custody.`,
          );
        }
      }
    }
  }
  for (const phase of ['initial', 'targeted', 'final']) {
    const phaseEntries = value.gateEvidence.filter((entry) => entry.phase === phase);
    if (phaseEntries.length !== 0 && phaseEntries.length !== value.gates.length)
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `${phase} gate evidence must cover the exact frozen gate set.`,
      );
    const seen = new Set();
    for (const entry of phaseEntries) {
      const gate = value.gates.find(({ id }) => id === entry.gateId);
      if (gate.dependsOn.some((id) => !seen.has(id)))
        fail('E_SHIP_CLOSURE_INVALID', `${phase} gate evidence is not in dependency order.`);
      seen.add(entry.gateId);
    }
  }
  if (
    value.events.some((event, index) => event.generation !== index + 1) ||
    value.generation !== value.events.length
  ) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Closure generation must equal one contiguous, append-only event sequence.',
    );
  }
  const createdAt = Date.parse(value.createdAt);
  const eventTimes = value.events.map(({ at }) => Date.parse(at));
  if (eventTimes.some((at, index) => at < createdAt || (index > 0 && at < eventTimes[index - 1])))
    fail('E_SHIP_CLOSURE_INVALID', 'Closure event timestamps must be monotonic from createdAt.');
  if (value.updatedAt !== (value.events.at(-1)?.at ?? value.createdAt))
    fail('E_SHIP_CLOSURE_INVALID', 'updatedAt must equal the latest runtime event timestamp.');
  const eventIndexes = (type) =>
    value.events.flatMap((event, index) => (event.type === type ? [index] : []));
  const opened = eventIndexes('review.opened');
  const closed = eventIndexes('review.closed');
  const corrections = eventIndexes('correction.registered');
  const gateEvents = eventIndexes('gates.recorded');
  const finalized = eventIndexes('closure.finalized');
  if (opened.length > 0 && value.tasks.some(({ status }) => status !== 'completed')) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Opening executive review requires every frozen task to be completed.',
    );
  }
  const firstReview = opened[0] ?? finalized[0] ?? value.events.length;
  if (
    value.events.some(
      (event, index) =>
        ['task.completed', 'task.blocked'].includes(event.type) && index >= firstReview,
    )
  )
    fail('E_SHIP_CLOSURE_INVALID', 'Task result events must precede review and finalization.');
  if (
    opened.length < closed.length ||
    opened.some(
      (index, phaseIndex) => closed[phaseIndex] !== undefined && index >= closed[phaseIndex],
    )
  )
    fail('E_SHIP_CLOSURE_INVALID', 'Review open/close chronology is invalid.');
  if (
    corrections[0] !== undefined &&
    (!(closed[0] < corrections[0]) || (opened[1] !== undefined && !(corrections[0] < opened[1])))
  )
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Correction chronology must sit between initial close and targeted open.',
    );
  const gatePhases = [...new Set(value.gateEvidence.map(({ phase }) => phase))];
  for (const [index, phase] of gatePhases.entries()) {
    const gateIndex = gateEvents[index];
    const lower =
      phase === 'initial' ? opened[0] : phase === 'targeted' ? opened[1] : closed.at(-1);
    const upper =
      phase === 'initial'
        ? (closed[0] ?? value.events.length)
        : phase === 'targeted'
          ? (closed[1] ?? value.events.length)
          : (finalized[0] ?? value.events.length);
    if (gateIndex === undefined || lower === undefined || !(lower < gateIndex && gateIndex < upper))
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `${phase} gate evidence is outside its legal lifecycle window.`,
      );
  }
  for (const [index, review] of value.reviews.entries()) {
    if (review.closedAt !== value.events[closed[index]]?.at)
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `${review.phase} closedAt does not bind its runtime review event.`,
      );
  }
  if (
    value.candidateRevisions[0] &&
    opened[0] !== undefined &&
    value.candidateRevisions[0].sealedAt !== value.events[opened[0]].at
  )
    fail('E_SHIP_CLOSURE_INVALID', 'Initial candidate sealedAt does not bind review.opened.');
  if (
    value.candidateRevisions[1] &&
    value.candidateRevisions[1].sealedAt !== value.events[corrections[0]]?.at
  )
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Correction candidate sealedAt does not bind correction.registered.',
    );
  if (value.candidateRevisions.length === 2 && value.correctionImpact === null)
    fail('E_SHIP_CLOSURE_INVALID', 'A correction successor requires one correction impact record.');
  if (value.correctionImpact !== null && value.candidateRevisions.length !== 2)
    fail('E_SHIP_CLOSURE_INVALID', 'Correction impact must bind exactly two candidate revisions.');
  if (value.correctionImpact !== null) {
    const requiredFindingIds = blockingFindings(value.reviews[0] ?? { findings: [] })
      .map(({ id }) => id)
      .sort();
    if (!sameMembers(value.correctionImpact.findingIds, requiredFindingIds)) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Correction impact does not account for the exact initial blocking finding batch.',
      );
    }
    if (value.candidateRevisions[0].digest === value.candidateRevisions[1].digest) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'A correction successor must have a distinct candidate identity.',
      );
    }
    const derivedPaths = candidateCorrectionPaths(
      value.candidateRevisions[0],
      value.candidateRevisions[1],
    );
    const pathKeys = (paths) =>
      paths.map(({ repositoryKey, path }) => `${repositoryKey}:${path}`).sort();
    const submittedPaths = value.correctionImpact.paths.map((entry) =>
      normalizeRepositoryPath(entry, 'correction impact path'),
    );
    if (JSON.stringify(pathKeys(submittedPaths)) !== JSON.stringify(pathKeys(derivedPaths))) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Correction impact paths do not equal the canonical candidate delta.',
      );
    }
    const derivedGateIds = value.gates
      .filter((gate) =>
        gate.inputs.some((input) => derivedPaths.some((path) => pathsIntersect(input, path))),
      )
      .map(({ id }) => id)
      .sort();
    if (
      JSON.stringify([...value.correctionImpact.affectedGateIds].sort()) !==
      JSON.stringify(derivedGateIds)
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Correction impact affected gates do not equal the frozen input intersection.',
      );
    }
  }
  const lifecycleValid = (() => {
    const candidates = value.candidateRevisions.length;
    const reviews = value.reviews.length;
    const blockers = reviews ? blockingFindings(value.reviews.at(-1)).length : 0;
    if (value.recordType === 'receipt') return true;
    if (value.state === 'implementing') return candidates === 0 && reviews === 0;
    if (value.state === 'reviewing_initial') return candidates === 1 && reviews === 0;
    if (value.state === 'correction_required')
      return reviews === 1 && candidates >= 1 && blockers > 0;
    if (value.state === 'reviewing_targeted')
      return (
        candidates === 2 &&
        (reviews === 1 || (allowTargetedClosing && reviews === 2 && blockers > 0)) &&
        value.correctionImpact !== null
      );
    if (value.state === 'ready_for_final')
      return reviews >= 1 && reviews === candidates && blockers === 0;
    return false;
  })();
  if (!lifecycleValid)
    fail(
      'E_SHIP_CLOSURE_INVALID',
      `State ${value.state} does not match candidate, review, and correction custody.`,
    );
  if (value.recordType === 'receipt') {
    if (
      !TERMINAL_STATES.has(value.state) ||
      value.terminal?.status !== value.state ||
      value.receiptHash === null
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'A receipt must contain one matching immutable terminal result.',
      );
    }
    if (value.repositories.some(({ root }) => root !== null))
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Terminal receipts cannot retain machine-local repository roots.',
      );
    const candidate = value.candidateRevisions.at(-1);
    if (
      !candidate ||
      value.terminal.candidateDigest !== candidate.digest ||
      value.terminal.gateEvidenceDigest !== sha256Jcs(value.gateEvidence)
    ) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'Terminal receipt does not bind the final candidate and complete gate evidence.',
      );
    }
    if (value.reviews.length === 0 && candidate.sealedAt !== value.terminal.at) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'A no-review terminal candidate must be sealed by the closure.finalized runtime transition.',
      );
    }
    const expectedReceiptHash = sha256Jcs({ ...value, receiptHash: null });
    if (value.receiptHash !== expectedReceiptHash)
      fail(
        'E_SHIP_CLOSURE_INVALID',
        'receiptHash does not equal the canonical terminal receipt content.',
      );
    if (value.events.at(-1)?.type !== 'closure.finalized')
      fail('E_SHIP_CLOSURE_INVALID', 'A terminal receipt must end with closure.finalized.');
    if (value.state === 'passed') {
      if (
        value.reviews.length !== value.candidateRevisions.length ||
        value.reviews.length === 0 ||
        value.tasks.some(({ status }) => status !== 'completed') ||
        blockingFindings(value.reviews.at(-1) ?? { findings: [] }).length
      ) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          'PASS requires one completed review per candidate, completed tasks, and no blocking findings.',
        );
      }
      const finalEvidence = value.gateEvidence.filter(({ phase }) => phase === 'final');
      if (
        finalEvidence.length !== value.gates.length ||
        finalEvidence.some((entry) => !['passed', 'reused'].includes(entry.status))
      ) {
        fail('E_SHIP_CLOSURE_INVALID', 'PASS requires complete passing final gate evidence.');
      }
      const finalSuite = value.gates.find(({ finalRelevantSuite }) => finalRelevantSuite);
      if (finalEvidence.find(({ gateId }) => gateId === finalSuite.id)?.status !== 'passed')
        fail('E_SHIP_CLOSURE_INVALID', 'PASS requires an executed terminal final relevant suite.');
    } else {
      if (typeof value.terminal.reason !== 'string' || value.terminal.reason.trim().length === 0)
        fail('E_SHIP_CLOSURE_INVALID', 'BLOCKED requires a nonblank terminal reason.');
      const hasBlockedTask = value.tasks.some(({ status }) => status === 'blocked');
      const completedTaskIds = new Set(
        value.tasks.filter(({ status }) => status === 'completed').map(({ id }) => id),
      );
      const hasIndependentReadyTask = value.tasks.some(
        ({ status, dependsOn }) =>
          status === 'pending' && dependsOn.every((id) => completedTaskIds.has(id)),
      );
      const latestReviewBlocker =
        blockingFindings(value.reviews.at(-1) ?? { findings: [] }).length > 0;
      const finalEvidence = value.gateEvidence.filter(({ phase }) => phase === 'final');
      const hasFinalGateFailure =
        value.reviews.length > 0 &&
        !latestReviewBlocker &&
        (finalEvidence.length !== value.gates.length ||
          finalEvidence.some(({ status }) => !['passed', 'reused'].includes(status)));
      const taskBlockedShape =
        hasBlockedTask &&
        !hasIndependentReadyTask &&
        value.candidateRevisions.length === 1 &&
        value.reviews.length === 0 &&
        value.correctionImpact === null;
      const initialReviewBlockedShape =
        !hasBlockedTask &&
        value.candidateRevisions.length === 1 &&
        value.reviews.length === 1 &&
        latestReviewBlocker &&
        value.correctionImpact === null;
      const targetedReviewBlockedShape =
        !hasBlockedTask &&
        value.candidateRevisions.length === 2 &&
        value.reviews.length === 2 &&
        latestReviewBlocker &&
        value.correctionImpact !== null;
      const finalGateBlockedShape =
        !hasBlockedTask &&
        value.reviews.length === value.candidateRevisions.length &&
        !latestReviewBlocker &&
        hasFinalGateFailure;
      if (
        !taskBlockedShape &&
        !initialReviewBlockedShape &&
        !targetedReviewBlockedShape &&
        !finalGateBlockedShape
      ) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          'BLOCKED receipt does not match a legal task, initial-review, targeted-review, or final-gate terminal transition.',
        );
      }
    }
    if (value.terminal.at !== value.events.at(-1)?.at)
      fail('E_SHIP_CLOSURE_INVALID', 'terminal.at must equal closure.finalized runtime time.');
  } else if (
    value.receiptHash !== null ||
    value.terminal !== null ||
    TERMINAL_STATES.has(value.state)
  ) {
    fail('E_SHIP_CLOSURE_INVALID', 'Active closures cannot claim a terminal receipt.');
  }
  const finalizedEvents = value.events.filter(({ type }) => type === 'closure.finalized').length;
  if (finalizedEvents !== (value.recordType === 'receipt' ? 1 : 0))
    fail('E_SHIP_CLOSURE_INVALID', 'Finalization event cardinality does not match record type.');
  if (value.events.filter(({ type }) => type === 'review.closed').length !== value.reviews.length)
    fail('E_SHIP_CLOSURE_INVALID', 'Review event cardinality does not match persisted reviews.');
  if (
    value.events.filter(({ type }) => type === 'gates.recorded').length !==
    new Set(value.gateEvidence.map(({ phase }) => phase)).size
  )
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Gate event cardinality does not match persisted phase evidence.',
    );
  if (
    value.events.filter(({ type }) => type === 'correction.registered').length !==
    (value.correctionImpact === null ? 0 : 1)
  )
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Correction event cardinality does not match correction custody.',
    );
  const expectedOpenCount =
    value.reviews.length +
    (value.state === 'reviewing_initial' ||
    (value.state === 'reviewing_targeted' && value.reviews.length === 1)
      ? 1
      : 0);
  if (opened.length !== expectedOpenCount)
    fail('E_SHIP_CLOSURE_INVALID', 'Review open event cardinality does not match lifecycle state.');
  if (
    value.events.filter(({ type }) => ['task.completed', 'task.blocked'].includes(type)).length !==
    value.tasks.filter(({ status }) => status !== 'pending').length
  ) {
    fail('E_SHIP_CLOSURE_INVALID', 'Task event cardinality does not match frozen task states.');
  }
  assertEventReceiptBindings(value);
  return value;
}

export function assertShipReceiptLineage(receipts) {
  if (!Array.isArray(receipts))
    fail('E_SHIP_STORAGE_CONTEXT_INVALID', 'Terminal receipt lineage must be an array.');
  receipts.forEach((receipt) => assertClosure(receipt));
  const byHash = new Map();
  const runIds = new Set();
  const childByParent = new Map();
  for (const receipt of receipts) {
    if (runIds.has(receipt.runId) || byHash.has(receipt.receiptHash))
      fail(
        'E_SHIP_STORAGE_CONTEXT_INVALID',
        'Terminal receipt lineage contains duplicate run or receipt identities.',
      );
    runIds.add(receipt.runId);
    byHash.set(receipt.receiptHash, receipt);
    if (receipt.startedFromReceiptHash !== null) {
      if (childByParent.has(receipt.startedFromReceiptHash))
        fail(
          'E_SHIP_STORAGE_CONTEXT_INVALID',
          `Receipt ${receipt.startedFromReceiptHash} has more than one successor.`,
        );
      childByParent.set(receipt.startedFromReceiptHash, receipt);
    }
  }
  const rootTaskOwner = new Map();
  for (const receipt of receipts.filter(
    ({ startedFromReceiptHash }) => startedFromReceiptHash === null,
  )) {
    for (const taskId of receipt.approvedScope.taskIds) {
      const prior = rootTaskOwner.get(taskId);
      if (prior)
        fail(
          'E_SHIP_STORAGE_CONTEXT_INVALID',
          `Independent terminal receipts ${prior} and ${receipt.runId} overlap task ${taskId}; overlapping custody requires a linear reopen successor.`,
        );
      rootTaskOwner.set(taskId, receipt.runId);
    }
  }
  for (const receipt of receipts) {
    if (receipt.startedFromReceiptHash === null) continue;
    const parent = byHash.get(receipt.startedFromReceiptHash);
    if (!parent)
      fail(
        'E_SHIP_STORAGE_CONTEXT_INVALID',
        `Receipt ${receipt.runId} has an orphan reopen parent.`,
      );
    if (Date.parse(receipt.createdAt) < Date.parse(parent.terminal.at))
      fail(
        'E_SHIP_STORAGE_CONTEXT_INVALID',
        `Receipt ${receipt.runId} predates its reopen parent.`,
      );
    const repositoryKeys = (record) =>
      record.repositories.map(({ repositoryKey }) => repositoryKey);
    const gateInputsExpandMonotonically = (() => {
      if (receipt.gates.length !== parent.gates.length) return false;
      return parent.gates.every((parentGate, index) => {
        const { inputs: parentInputs, ...parentAuthority } = parentGate;
        const { inputs: childInputs, ...childAuthority } = receipt.gates[index];
        if (sha256Jcs(parentAuthority) !== sha256Jcs(childAuthority)) return false;
        const childInputKeys = new Set(childInputs.map((input) => sha256Jcs(input)));
        return parentInputs.every((input) => childInputKeys.has(sha256Jcs(input)));
      });
    })();
    if (
      receipt.approvedScope.digest !== parent.approvedScope.digest ||
      sha256Jcs(repositoryKeys(receipt)) !== sha256Jcs(repositoryKeys(parent)) ||
      receipt.rosterDigest !== parent.rosterDigest ||
      !gateInputsExpandMonotonically
    ) {
      fail(
        'E_SHIP_STORAGE_CONTEXT_INVALID',
        `Receipt ${receipt.runId} changes immutable reopen scope, repositories, roster, or gate authority.`,
      );
    }
    const seen = new Set([receipt.receiptHash]);
    let cursor = parent;
    while (cursor) {
      if (seen.has(cursor.receiptHash))
        fail('E_SHIP_STORAGE_CONTEXT_INVALID', 'Terminal receipt lineage is cyclic.');
      seen.add(cursor.receiptHash);
      cursor =
        cursor.startedFromReceiptHash === null ? null : byHash.get(cursor.startedFromReceiptHash);
    }
  }
  return receipts;
}

function validateFinding(finding, state) {
  exactKeys(finding, FINDING_KEYS, `finding ${finding?.id ?? '<unknown>'}`);
  if (!/^fnd_[a-f0-9]{32}$/.test(finding.id))
    fail('E_SHIP_REVIEW_INVALID', `Invalid finding ID ${finding.id}.`);
  if (!['P0', 'P1', 'P2'].includes(finding.severity))
    fail('E_SHIP_REVIEW_INVALID', `Invalid severity for ${finding.id}.`);
  if (
    ![
      'acceptance',
      'security',
      'privacy',
      'correctness',
      'data-loss',
      'release-integrity',
    ].includes(finding.basis)
  ) {
    fail('E_SHIP_REVIEW_INVALID', `Invalid basis for ${finding.id}.`);
  }
  if (
    typeof finding.title !== 'string' ||
    !finding.title ||
    typeof finding.evidence !== 'string' ||
    !finding.evidence
  ) {
    fail('E_SHIP_REVIEW_INVALID', `Finding ${finding.id} requires a title and evidence.`);
  }
  if (
    !Array.isArray(finding.taskIds) ||
    finding.taskIds.some((id) => !state.tasks.some((task) => task.id === id))
  ) {
    fail('E_SHIP_REVIEW_INVALID', `Finding ${finding.id} references an unknown task.`);
  }
  if (!Array.isArray(finding.paths))
    fail('E_SHIP_REVIEW_INVALID', `Finding ${finding.id} paths must be an array.`);
  finding.paths = finding.paths.map((entry) =>
    normalizeRepositoryPath(entry, `finding ${finding.id} path`),
  );
  const repositories = repositoryMap(state.repositories, { requireRoots: false });
  if (finding.paths.some(({ repositoryKey }) => !repositories.has(repositoryKey))) {
    fail('E_SHIP_REVIEW_INVALID', `Finding ${finding.id} references an undeclared repository.`);
  }
  if (
    ['P0', 'P1'].includes(finding.severity) &&
    finding.taskIds.length === 0 &&
    finding.paths.length === 0
  ) {
    fail(
      'E_SHIP_REVIEW_INVALID',
      `Blocking finding ${finding.id} must identify at least one affected task or repository path.`,
    );
  }
  if (
    !Array.isArray(finding.acceptanceRefs) ||
    finding.acceptanceRefs.some((entry) => typeof entry !== 'string' || !entry)
  ) {
    fail('E_SHIP_REVIEW_INVALID', `Finding ${finding.id} acceptanceRefs must be strings.`);
  }
  if (!['open', 'resolved', 'remains', 'deferred'].includes(finding.disposition)) {
    fail('E_SHIP_REVIEW_INVALID', `Finding ${finding.id} has an invalid disposition.`);
  }
  return finding;
}

export function validateEvent(event) {
  const expected = EVENT_KEYS[event?.type];
  if (!expected)
    fail(
      'E_SHIP_EVENT_INVALID',
      `Unsupported SHIP closure event type: ${event?.type ?? '<missing>'}.`,
    );
  const hasRuntimeId = Object.hasOwn(event ?? {}, 'eventId');
  exactKeys(event, hasRuntimeId ? [...expected, 'eventId'] : expected, `event ${event.type}`);
  const publicEvent = clone(event);
  delete publicEvent.eventId;
  const eventId = `evt_${sha256Jcs(publicEvent).slice('sha256:'.length, 'sha256:'.length + 32)}`;
  if (hasRuntimeId && event.eventId !== eventId)
    fail(
      'E_SHIP_EVENT_INVALID',
      'eventId is runtime-owned and does not match the canonical event bytes.',
    );
  if (!Number.isSafeInteger(event.expectedGeneration) || event.expectedGeneration < 0)
    fail('E_SHIP_EVENT_INVALID', 'expectedGeneration must be a non-negative integer.');
  return { ...publicEvent, eventId };
}

function assertEventReceiptBindings(state) {
  let reviewIndex = 0;
  let gatePhaseIndex = 0;
  let browserRecordIndex = 0;
  const matchedTaskIds = new Set();
  const completedTaskIds = new Set();
  const gatePhases = ['initial', 'targeted', 'final'].filter((phase) =>
    state.gateEvidence.some((entry) => entry.phase === phase),
  );
  const initialFindingIds = new Set(state.reviews[0]?.findings.map(({ id }) => id) ?? []);
  const assertPublic = (receipt, publicEvent) => {
    const normalized = validateEvent(publicEvent);
    if (receipt.eventId !== normalized.eventId || receipt.inputDigest !== sha256Jcs(normalized)) {
      fail(
        'E_SHIP_CLOSURE_INVALID',
        `Event receipt ${receipt.eventId} does not bind its accepted ${receipt.type} input bytes.`,
      );
    }
  };
  for (const receipt of state.events) {
    const expectedGeneration = receipt.generation - 1;
    if (receipt.type === 'task.completed' || receipt.type === 'task.blocked') {
      const expectedStatus = receipt.type === 'task.completed' ? 'completed' : 'blocked';
      const matches = state.tasks
        .filter(({ status }) => status === expectedStatus)
        .filter((task) => {
          const publicEvent = {
            type: receipt.type,
            expectedGeneration,
            taskId: task.id,
            agent: task.agent,
            ...(receipt.type === 'task.blocked' ? { reason: task.blockedReason } : {}),
            filesWritten: task.filesWritten,
            filesModified: task.filesModified,
          };
          const normalized = validateEvent(publicEvent);
          return (
            normalized.eventId === receipt.eventId && sha256Jcs(normalized) === receipt.inputDigest
          );
        });
      if (matches.length !== 1)
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Task event receipt ${receipt.eventId} does not bind exactly one frozen task result.`,
        );
      const [task] = matches;
      if (matchedTaskIds.has(task.id))
        fail('E_SHIP_CLOSURE_INVALID', `Task ${task.id} has more than one accepted result event.`);
      if (task.dependsOn.some((dependencyId) => !completedTaskIds.has(dependencyId))) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Task ${task.id} result precedes completion of its frozen dependencies.`,
        );
      }
      matchedTaskIds.add(task.id);
      if (expectedStatus === 'completed') completedTaskIds.add(task.id);
    } else if (receipt.type === 'review.opened') {
      assertPublic(receipt, { type: 'review.opened', expectedGeneration });
    } else if (receipt.type === 'review.closed') {
      const review = state.reviews[reviewIndex++];
      if (!review)
        fail('E_SHIP_CLOSURE_INVALID', 'Review event has no persisted consolidated review.');
      const findings = review.findings.map((finding) => ({
        ...finding,
        id: review.phase === 'initial' || !initialFindingIds.has(finding.id) ? null : finding.id,
      }));
      assertPublic(receipt, {
        type: 'review.closed',
        expectedGeneration,
        phase: review.phase,
        candidateRevision: review.candidateRevision,
        candidateDigest: review.candidateDigest,
        reviewerIds: review.reviewerIds,
        contributions: review.contributions,
        findings,
        reviewedFindingIds: review.reviewedFindingIds,
        summary: review.summary,
        rosterDigest: review.rosterDigest,
        gateSetDigest: review.gateSetDigest,
      });
    } else if (receipt.type === 'correction.registered') {
      assertPublic(receipt, {
        type: 'correction.registered',
        expectedGeneration,
        impact: state.correctionImpact,
      });
    } else if (receipt.type === 'browser-qa.recorded') {
      const record = state.browserQaRecords?.[browserRecordIndex++];
      if (!record) fail('E_SHIP_CLOSURE_INVALID', 'Browser QA event has no persisted gate record.');
      assertPublic(receipt, { type: 'browser-qa.recorded', expectedGeneration, record });
    } else if (receipt.type === 'gates.recorded') {
      const phase = gatePhases[gatePhaseIndex++];
      const evidence = state.gateEvidence.filter((entry) => entry.phase === phase);
      const candidate =
        phase === 'initial'
          ? state.candidateRevisions[0]
          : phase === 'targeted'
            ? state.candidateRevisions[1]
            : state.candidateRevisions.at(-1);
      const inputDigest = sha256Jcs({ phase, candidateDigest: candidate?.digest, evidence });
      const eventId = `evt_${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`;
      if (receipt.eventId !== eventId || receipt.inputDigest !== inputDigest) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          `Gate event receipt ${receipt.eventId} does not bind the exact ${phase} evidence batch.`,
        );
      }
    } else if (receipt.type === 'closure.finalized') {
      const inputDigest = sha256Jcs({
        runId: state.runId,
        state: state.state,
        candidateDigest: state.terminal?.candidateDigest,
        gateEvidenceDigest: state.terminal?.gateEvidenceDigest,
      });
      const eventId = `evt_${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`;
      if (receipt.eventId !== eventId || receipt.inputDigest !== inputDigest) {
        fail(
          'E_SHIP_CLOSURE_INVALID',
          'Finalization event receipt does not bind the terminal result.',
        );
      }
    }
  }
  const persistedTaskIds = state.tasks
    .filter(({ status }) => status !== 'pending')
    .map(({ id }) => id)
    .sort();
  if (JSON.stringify([...matchedTaskIds].sort()) !== JSON.stringify(persistedTaskIds)) {
    fail(
      'E_SHIP_CLOSURE_INVALID',
      'Task event receipts do not bijectively cover every persisted task result.',
    );
  }
}

function runtimeFindingId(state, event, finding, index) {
  const identity = {
    runId: state.runId,
    phase: event.phase,
    candidateDigest: event.candidateDigest,
    index,
    finding: { ...finding, id: null },
  };
  return `fnd_${sha256Jcs(identity).slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

export function blockingFindings(review) {
  return review.findings.filter(
    ({ severity, disposition }) =>
      ['P0', 'P1'].includes(severity) && ['open', 'remains'].includes(disposition),
  );
}

export function currentCandidate(state) {
  return state.candidateRevisions.at(-1) ?? null;
}

export function phaseEvidence(state, phase) {
  const candidate = currentCandidate(state);
  return state.gateEvidence.filter(
    (entry) => entry.phase === phase && entry.candidateDigest === candidate?.digest,
  );
}

function requirePassingPhaseGates(state, phase) {
  const evidence = phaseEvidence(state, phase);
  for (const gate of state.gates) {
    const entry = evidence.find(({ gateId }) => gateId === gate.id);
    if (!entry || !['passed', 'reused'].includes(entry.status)) {
      fail(
        'E_SHIP_GATE_INCOMPLETE',
        `Gate ${gate.id} has no passing ${phase} evidence for the sealed candidate.`,
      );
    }
  }
}

function requireCompletePhaseGates(state, phase) {
  const evidence = phaseEvidence(state, phase);
  if (evidence.length !== state.gates.length)
    fail(
      'E_SHIP_GATE_INCOMPLETE',
      `${phase} review requires the exact frozen gate evidence batch.`,
    );
}

function requireRiskCoverage(state, classification) {
  assertShipRiskClassification(classification);
  const missing = classification.selectedSpecialists.filter(
    (id) => !state.reviewerRoster.includes(id),
  );
  const browserMissing =
    classification.browserQa.required &&
    !state.gates.some(({ gateType }) => gateType === 'browser-qa');
  if (missing.length || browserMissing) {
    fail(
      'E_SHIP_RISK_EXPANDED',
      'The sealed candidate expands beyond the reviewer or browser coverage frozen at SHIP start.',
      '',
      { missingSpecialists: missing, browserGateMissing: browserMissing },
    );
  }
}

function appendEventReceipt(state, event, inputDigest, now) {
  state.generation += 1;
  state.updatedAt = now;
  state.events.push({
    eventId: event.eventId,
    type: event.type,
    inputDigest,
    generation: state.generation,
    at: now,
  });
}

/**
 * Pure monotonic lifecycle reducer. Repository capture, clocks, locks, gate
 * execution, and projections are supplied by the owning runtime boundary.
 */
export function reduceShipClosure(current, suppliedEvent, runtime = {}) {
  const state = assertClosure(clone(current));
  const event = validateEvent(suppliedEvent);
  const inputDigest = runtime.inputDigest ?? sha256Jcs(event);
  if (typeof runtime.now !== 'string')
    fail(
      'E_SHIP_RUNTIME_CONTEXT_REQUIRED',
      'The pure SHIP reducer requires an explicit runtime clock value.',
    );
  const now = runtime.now;
  const prior = state.events.find(({ eventId }) => eventId === event.eventId);
  if (prior) {
    if (prior.inputDigest === inputDigest) return state;
    fail(
      'E_SHIP_EVENT_REPLAY_DIVERGED',
      `Event ${event.eventId} was replayed with different bytes.`,
    );
  }
  if (state.recordType === 'receipt' || TERMINAL_STATES.has(state.state)) {
    fail('E_SHIP_TERMINAL', `SHIP run ${state.runId} is terminal and cannot accept ${event.type}.`);
  }
  if (event.expectedGeneration !== state.generation) {
    fail(
      'E_SHIP_GENERATION_CONFLICT',
      `Expected generation ${event.expectedGeneration}, current generation is ${state.generation}.`,
      '',
      { currentGeneration: state.generation },
    );
  }

  if (event.type === 'task.completed' || event.type === 'task.blocked') {
    if (state.state !== 'implementing')
      fail('E_SHIP_STATE_TRANSITION_INVALID', `${event.type} is valid only while implementing.`);
    const task = state.tasks.find(({ id }) => id === event.taskId);
    if (!task) fail('E_SHIP_TASK_UNKNOWN', `Unknown task ${event.taskId}.`);
    if (task.status !== 'pending')
      fail('E_SHIP_STATE_TRANSITION_INVALID', `Task ${task.id} is already ${task.status}.`);
    const incomplete = task.dependsOn.filter(
      (id) => state.tasks.find((candidate) => candidate.id === id)?.status !== 'completed',
    );
    if (incomplete.length)
      fail(
        'E_SHIP_TASK_DEPENDENCY',
        `Task ${task.id} has incomplete dependencies: ${incomplete.join(', ')}.`,
      );
    task.agent = event.agent;
    task.filesWritten = event.filesWritten.map((entry) =>
      normalizeRepositoryPath(entry, `${event.type} filesWritten`),
    );
    task.filesModified = event.filesModified.map((entry) =>
      normalizeRepositoryPath(entry, `${event.type} filesModified`),
    );
    const repositories = repositoryMap(state.repositories);
    if (
      [...task.filesWritten, ...task.filesModified].some(
        ({ repositoryKey }) => !repositories.has(repositoryKey),
      )
    ) {
      fail(
        'E_SHIP_REPOSITORY_INVALID',
        `${event.type} references a repository outside the frozen set.`,
      );
    }
    if (event.type === 'task.completed') {
      task.status = 'completed';
    } else {
      task.status = 'blocked';
      task.blockedReason = event.reason;
    }
  } else if (event.type === 'review.opened') {
    if (state.state === 'implementing') {
      if (state.tasks.some(({ status }) => status !== 'completed'))
        fail('E_SHIP_TASKS_INCOMPLETE', 'Initial review requires every task to be completed.');
      if (state.candidateRevisions.length !== 0 || !runtime.candidate)
        fail('E_SHIP_CANDIDATE_INVALID', 'Initial review requires one runtime-sealed candidate.');
      if (state.riskClassification) {
        requireRiskCoverage(state, runtime.riskClassification);
      }
      state.candidateRevisions.push(clone(runtime.candidate));
      state.state = 'reviewing_initial';
    } else if (state.state === 'correction_required') {
      if (state.candidateRevisions.length !== 2)
        fail(
          'E_SHIP_CANDIDATE_INVALID',
          'Targeted review requires exactly one correction successor.',
        );
      state.state = 'reviewing_targeted';
    } else {
      fail('E_SHIP_STATE_TRANSITION_INVALID', `review.opened is not valid from ${state.state}.`);
    }
  } else if (event.type === 'browser-qa.recorded') {
    if (
      !state.riskClassification?.browserQa.required ||
      !['reviewing_initial', 'reviewing_targeted'].includes(state.state)
    ) {
      fail(
        'E_SHIP_STATE_TRANSITION_INVALID',
        'Browser QA evidence is accepted only for a frozen mandatory browser gate during review.',
      );
    }
    const candidate = currentCandidate(state);
    assertBrowserQaGateRecord(event.record, { requireAttested: true });
    assertBrowserQaRecordedEventAuthority(runtime.browserQaEventAuthority, event);
    if (
      event.record.candidateRevision !== candidate.revision ||
      event.record.candidateDigest !== candidate.digest ||
      event.record.requirementDigest !== state.riskClassification.browserQa.requirementDigest ||
      event.record.required !== true
    ) {
      fail(
        'E_BROWSER_QA_RESULT_FOREIGN',
        'Browser QA evidence does not bind the exact frozen candidate and requirement.',
      );
    }
    if (
      state.gateEvidence.some(
        ({ phase, candidateDigest }) =>
          phase === (state.state === 'reviewing_initial' ? 'initial' : 'targeted') &&
          candidateDigest === candidate.digest,
      )
    ) {
      fail(
        'E_BROWSER_QA_LATE',
        'Browser QA evidence cannot be replaced after phase gate evidence is frozen.',
      );
    }
    const priorRecord = state.browserQaRecords.find(
      ({ candidateRevision }) => candidate.revision === event.record.candidateRevision,
    );
    if (priorRecord) {
      if (priorRecord.recordDigest !== event.record.recordDigest)
        fail(
          'E_BROWSER_QA_REPLAY_DIVERGED',
          'Browser QA evidence for this candidate already has different bytes.',
        );
    } else state.browserQaRecords.push(clone(event.record));
  } else if (event.type === 'review.closed') {
    const phase =
      state.state === 'reviewing_initial'
        ? 'initial'
        : state.state === 'reviewing_targeted'
          ? 'targeted'
          : null;
    if (phase === null || event.phase !== phase)
      fail('E_SHIP_STATE_TRANSITION_INVALID', `review.closed phase does not match ${state.state}.`);
    if (!sameMembers(event.reviewerIds, state.reviewerRoster)) {
      fail(
        'E_SHIP_REVIEWER_UNDECLARED',
        'The consolidated review must include every frozen reviewer exactly once and no undeclared reviewer.',
      );
    }
    validateContributions(event.contributions, state.reviewerRoster);
    const candidate = currentCandidate(state);
    if (
      event.candidateRevision !== candidate.revision ||
      event.candidateDigest !== candidate.digest
    )
      fail('E_SHIP_CANDIDATE_INVALID', 'Review does not bind the exact current candidate.');
    if (event.rosterDigest !== state.rosterDigest || event.gateSetDigest !== state.gateSetDigest)
      fail('E_SHIP_REVIEW_INVALID', 'Review does not bind the frozen roster and gate set.');
    const suppliedFindingIds = event.findings.map(({ id }) => id);
    const findings = event.findings.map((finding, index) => {
      const normalized = clone(finding);
      if (normalized.id === null) normalized.id = runtimeFindingId(state, event, normalized, index);
      return validateFinding(normalized, state);
    });
    if (new Set(findings.map(({ id }) => id)).size !== findings.length)
      fail('E_SHIP_REVIEW_INVALID', 'Finding IDs must be unique within a review.');
    if (phase === 'initial') {
      if (suppliedFindingIds.some((id) => id !== null))
        fail(
          'E_SHIP_REVIEW_INVALID',
          'Initial finding IDs are runtime-owned and must be null in the submitted batch.',
        );
      if (event.reviewedFindingIds.length !== 0)
        fail('E_SHIP_REVIEW_INVALID', 'Initial review cannot claim prior finding targets.');
      if (
        findings.some(({ severity, disposition }) =>
          ['P0', 'P1'].includes(severity)
            ? disposition !== 'open'
            : !['deferred', 'resolved'].includes(disposition),
        )
      ) {
        fail(
          'E_SHIP_REVIEW_INVALID',
          'Initial P0/P1 findings must be open; P2 findings must be deferred or resolved.',
        );
      }
    } else {
      const required = blockingFindings(state.reviews[0])
        .map(({ id }) => id)
        .sort();
      if (JSON.stringify([...event.reviewedFindingIds].sort()) !== JSON.stringify(required)) {
        fail(
          'E_SHIP_REVIEW_INVALID',
          'Targeted review must account for every initial blocking finding exactly once.',
        );
      }
      for (const id of required) {
        const adjudication = findings.find((finding) => finding.id === id);
        if (!adjudication || !['resolved', 'remains'].includes(adjudication.disposition)) {
          fail('E_SHIP_REVIEW_INVALID', `Targeted review must resolve or retain ${id}.`);
        }
        const original = state.reviews[0].findings.find((finding) => finding.id === id);
        for (const field of ['severity', 'basis', 'title', 'taskIds', 'paths', 'acceptanceRefs']) {
          if (sha256Jcs(adjudication[field]) !== sha256Jcs(original[field])) {
            fail(
              'E_SHIP_REVIEW_INVALID',
              `Targeted adjudication ${id} changed immutable ${field} custody.`,
            );
          }
        }
      }
      for (const [index, suppliedId] of suppliedFindingIds.entries()) {
        if (suppliedId !== null && !required.includes(suppliedId)) {
          fail(
            'E_SHIP_REVIEW_INVALID',
            `Targeted review supplied foreign finding ID ${suppliedId} at index ${index}.`,
          );
        }
      }
      for (const finding of findings.filter(
        ({ id, severity }) => !required.includes(id) && ['P0', 'P1'].includes(severity),
      )) {
        if (!['open', 'remains'].includes(finding.disposition)) {
          fail(
            'E_SHIP_REVIEW_INVALID',
            `New targeted blocker ${finding.id} cannot be self-resolved in the batch that exposed it.`,
          );
        }
        if (
          !finding.paths.some((path) =>
            state.correctionImpact.paths.some((changed) => pathsIntersect(path, changed)),
          )
        ) {
          fail(
            'E_SHIP_REVIEW_INVALID',
            `New blocking finding ${finding.id} is not linked to the authorized correction scope.`,
          );
        }
      }
      if (
        findings.some(
          ({ severity, disposition }) =>
            severity === 'P2' && !['deferred', 'resolved'].includes(disposition),
        )
      ) {
        fail(
          'E_SHIP_REVIEW_INVALID',
          'P2 findings are non-blocking and must be deferred or resolved.',
        );
      }
    }
    const review = {
      phase,
      candidateRevision: candidate.revision,
      reviewerIds: clone(event.reviewerIds),
      contributions: clone(event.contributions),
      candidateDigest: candidate.digest,
      rosterDigest: state.rosterDigest,
      gateSetDigest: state.gateSetDigest,
      summary: event.summary,
      reviewedFindingIds: clone(event.reviewedFindingIds),
      findings,
      closedAt: now,
    };
    const blockers = blockingFindings(review);
    requireCompletePhaseGates(state, phase);
    if (blockers.length === 0) requirePassingPhaseGates(state, phase);
    state.reviews.push(review);
    state.state =
      blockers.length > 0
        ? phase === 'initial'
          ? 'correction_required'
          : 'reviewing_targeted'
        : 'ready_for_final';
  } else if (event.type === 'correction.registered') {
    if (
      state.state !== 'correction_required' ||
      state.candidateRevisions.length !== 1 ||
      state.correctionImpact !== null
    ) {
      fail(
        'E_SHIP_STATE_TRANSITION_INVALID',
        'Exactly one correction may follow the initial blocking review.',
      );
    }
    const required = blockingFindings(state.reviews[0])
      .map(({ id }) => id)
      .sort();
    const impact = clone(event.impact);
    exactKeys(impact, ['summary', 'findingIds', 'paths', 'affectedGateIds'], 'correction impact');
    if (JSON.stringify([...impact.findingIds].sort()) !== JSON.stringify(required)) {
      fail(
        'E_SHIP_CORRECTION_INVALID',
        'Correction impact must account for every blocking finding exactly once.',
      );
    }
    if (
      !runtime.candidate ||
      runtime.candidate.revision !== 2 ||
      runtime.candidate.digest === state.candidateRevisions[0].digest
    ) {
      fail(
        'E_SHIP_CORRECTION_INVALID',
        'The sole correction must seal one distinct successor candidate.',
      );
    }
    if (state.riskClassification) requireRiskCoverage(state, runtime.riskClassification);
    const submittedPaths = impact.paths.map((entry) =>
      normalizeRepositoryPath(entry, 'correction impact path'),
    );
    const derivedPaths = candidateCorrectionPaths(state.candidateRevisions[0], runtime.candidate);
    const orderedPathKey = (paths) =>
      paths.map(({ repositoryKey, path }) => `${repositoryKey}:${path}`).sort();
    if (
      JSON.stringify(orderedPathKey(submittedPaths)) !==
      JSON.stringify(orderedPathKey(derivedPaths))
    ) {
      fail(
        'E_SHIP_CORRECTION_INVALID',
        'Correction impact paths must exactly equal the runtime-derived candidate delta.',
        '',
        { derivedPaths },
      );
    }
    const derivedGateIds = state.gates
      .filter((gate) =>
        gate.inputs.some((input) => derivedPaths.some((path) => pathsIntersect(input, path))),
      )
      .map(({ id }) => id)
      .sort();
    if (JSON.stringify([...impact.affectedGateIds].sort()) !== JSON.stringify(derivedGateIds)) {
      fail(
        'E_SHIP_CORRECTION_INVALID',
        'affectedGateIds must exactly equal the frozen gates whose bounded inputs intersect the correction.',
        '',
        { derivedGateIds },
      );
    }
    // Preserve the exact accepted ordering in the durable receipt. Validation
    // above treats these collections as sets, but the event identity binds the
    // submitted bytes; replacing them with runtime-sorted arrays would make a
    // valid, non-canonical submission fail its own receipt replay check.
    state.correctionImpact = {
      summary: impact.summary,
      findingIds: clone(impact.findingIds),
      paths: submittedPaths,
      affectedGateIds: clone(impact.affectedGateIds),
    };
    state.candidateRevisions.push(clone(runtime.candidate));
  }

  appendEventReceipt(state, event, inputDigest, now);
  if (
    event.type === 'review.closed' &&
    event.phase === 'targeted' &&
    blockingFindings(state.reviews.at(-1)).length > 0
  ) {
    return terminalizeShipClosure(state, {
      now,
      forcedBlockedReason: 'Targeted re-review retained or exposed blocking findings.',
    });
  }
  return assertClosure(state);
}

export function recordShipGateEvidence(current, { phase, evidence, expectedGeneration, now } = {}) {
  const state = assertClosure(clone(current));
  if (typeof now !== 'string')
    fail(
      'E_SHIP_RUNTIME_CONTEXT_REQUIRED',
      'Gate recording requires an explicit runtime clock value.',
    );
  if (!['initial', 'targeted', 'final'].includes(phase))
    fail('E_SHIP_GATE_PHASE_INVALID', `Invalid gate phase ${phase}.`);
  if (expectedGeneration !== undefined && Number(expectedGeneration) !== state.generation) {
    fail(
      'E_SHIP_GENERATION_CONFLICT',
      `Expected generation ${expectedGeneration}, current generation is ${state.generation}.`,
    );
  }
  const expectedState = {
    initial: 'reviewing_initial',
    targeted: 'reviewing_targeted',
    final: 'ready_for_final',
  }[phase];
  if (state.state !== expectedState)
    fail('E_SHIP_STATE_TRANSITION_INVALID', `${phase} gates are not valid from ${state.state}.`);
  if (!Array.isArray(evidence) || evidence.length !== state.gates.length)
    fail('E_SHIP_GATE_INCOMPLETE', `${phase} gate evidence must cover the exact frozen gate set.`);
  const candidate = currentCandidate(state);
  if (
    !candidate ||
    evidence.some((entry) => entry.phase !== phase || entry.candidateDigest !== candidate.digest)
  ) {
    fail(
      'E_SHIP_CANDIDATE_INVALID',
      `${phase} gate evidence does not bind the current sealed candidate.`,
    );
  }
  if (phaseEvidence(state, phase).length !== 0)
    fail('E_SHIP_GATE_REPLAY_DIVERGED', `${phase} gate evidence is already recorded.`);
  state.gateEvidence.push(...clone(evidence));
  const inputDigest = sha256Jcs({ phase, candidateDigest: candidate.digest, evidence });
  state.generation += 1;
  state.updatedAt = now;
  state.events.push({
    eventId: `evt_${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    type: 'gates.recorded',
    inputDigest,
    generation: state.generation,
    at: now,
  });
  return assertClosure(state);
}

export function terminalizeShipClosure(
  current,
  { now, candidate: suppliedCandidate = null, forcedBlockedReason = null } = {},
) {
  const state = assertClosure(clone(current), {
    allowTargetedClosing: forcedBlockedReason !== null,
  });
  if (typeof now !== 'string')
    fail(
      'E_SHIP_RUNTIME_CONTEXT_REQUIRED',
      'Closure finalization requires an explicit runtime clock value.',
    );
  let candidate = currentCandidate(state);
  if (candidate === null) {
    if (!suppliedCandidate || suppliedCandidate.revision !== 1)
      fail(
        'E_SHIP_CANDIDATE_INVALID',
        'Blocking before review requires one runtime-sealed terminal candidate.',
      );
    candidate = clone(suppliedCandidate);
    state.candidateRevisions.push(candidate);
  }
  let terminalReason = null;
  if (forcedBlockedReason !== null) {
    if (
      state.state !== 'reviewing_targeted' ||
      blockingFindings(state.reviews.at(-1) ?? { findings: [] }).length === 0
    ) {
      fail(
        'E_SHIP_STATE_TRANSITION_INVALID',
        'Only a targeted consolidated blocker batch may force terminal BLOCKED.',
      );
    }
    state.state = 'blocked';
    terminalReason = forcedBlockedReason;
  } else if (state.state === 'ready_for_final') {
    const evidence = phaseEvidence(state, 'final');
    const incomplete = state.gates.filter((gate) => {
      const entry = evidence.find(({ gateId }) => gateId === gate.id);
      return (
        !entry ||
        !['passed', 'reused'].includes(entry.status) ||
        (gate.finalRelevantSuite && entry.status !== 'passed')
      );
    });
    if (incomplete.length) {
      state.state = 'blocked';
      terminalReason = `Final gates did not pass on the terminal candidate: ${incomplete.map(({ id }) => id).join(', ')}.`;
    } else {
      state.state = 'passed';
    }
  } else if (
    state.state === 'implementing' &&
    state.tasks.some(({ status }) => status === 'blocked')
  ) {
    const completed = new Set(
      state.tasks.filter(({ status }) => status === 'completed').map(({ id }) => id),
    );
    const independentReady = state.tasks.filter(
      ({ status, dependsOn }) => status === 'pending' && dependsOn.every((id) => completed.has(id)),
    );
    if (independentReady.length)
      fail(
        'E_SHIP_TASKS_INCOMPLETE',
        `Drain the remaining independent task frontier before blocking: ${independentReady.map(({ id }) => id).join(', ')}.`,
      );
    state.state = 'blocked';
    terminalReason =
      'The approved task graph cannot complete because one or more tasks are blocked.';
  } else if (
    state.state === 'correction_required' &&
    state.candidateRevisions.length === 1 &&
    state.correctionImpact === null &&
    blockingFindings(state.reviews[0] ?? { findings: [] }).length > 0
  ) {
    state.state = 'blocked';
    terminalReason =
      'Initial blocking findings could not produce one distinct authorized correction successor.';
  } else if (state.state !== 'blocked') {
    fail(
      'E_SHIP_STATE_TRANSITION_INVALID',
      `finalize-ship requires ready_for_final or blocked, not ${state.state}.`,
    );
  }
  const gateEvidenceDigest = sha256Jcs(state.gateEvidence);
  const inputDigest = sha256Jcs({
    runId: state.runId,
    state: state.state,
    candidateDigest: candidate.digest,
    gateEvidenceDigest,
  });
  state.generation += 1;
  state.updatedAt = now;
  state.events.push({
    eventId: `evt_${inputDigest.slice('sha256:'.length, 'sha256:'.length + 32)}`,
    type: 'closure.finalized',
    inputDigest,
    generation: state.generation,
    at: now,
  });
  state.recordType = 'receipt';
  state.repositories = state.repositories.map((repository) => ({ ...repository, root: null }));
  state.terminal = {
    status: state.state,
    at: now,
    reason:
      state.state === 'blocked'
        ? (terminalReason ??
          state.tasks.find(({ blockedReason }) => blockedReason)?.blockedReason ??
          (blockingFindings(state.reviews.at(-1) ?? { findings: [] })
            .map(({ title }) => title)
            .join('; ') ||
            'SHIP closure blocked.'))
        : null,
    candidateDigest: candidate.digest,
    gateEvidenceDigest,
  };
  state.receiptHash = sha256Jcs({ ...state, receiptHash: null });
  return assertClosure(state);
}
