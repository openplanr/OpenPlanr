import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  REQUIRED_OPERATING_CANARY_EVIDENCE,
  validateOperatingCanaryEvidence,
} from './operating-canary-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const participantOrder = ['pipeline', 'cli', 'skills', 'marketplace'];
const repositories = {
  pipeline: 'openplanr/planr-pipeline',
  cli: 'openplanr/OpenPlanr',
  skills: 'openplanr/skills',
  marketplace: 'openplanr/marketplace',
};
const repositoryDirectories = {
  pipeline: 'planr-pipeline',
  cli: 'OpenPlanr',
  skills: 'skills',
  marketplace: 'marketplace',
};
const repoLocalWorkItems = {
  'SPEC-002': {
    pipeline: 'docs/implementation/operating-board.md',
    cli: 'docs/implementation/OPERATE-SPEC-002.md',
    skills: 'docs/implementation/operating-board.md',
    marketplace: 'docs/implementation/operating-board.md',
  },
  'SPEC-003': {
    pipeline: 'docs/implementation/guided-operating-board.md',
    cli: 'docs/implementation/OPERATE-SPEC-003.md',
    skills: 'docs/implementation/guided-operating-board.md',
    marketplace: 'docs/implementation/guided-operating-board.md',
  },
};
const states = new Set([
  'drafted',
  'preparing',
  'prepared',
  'promoting',
  'completed',
  'verified',
  'blocked',
  'compensating',
  'compensated',
  'failed',
  'forward-fix',
]);
const phases = new Set([
  'pending',
  'preparing',
  'prepared',
  'promoting',
  'merged',
  'published',
  'verified',
  'blocked',
  'compensated',
]);
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

function isDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function operationIntent(operation) {
  return {
    kind: operation.kind,
    protocolVersion: operation.protocolVersion,
    operationId: operation.operationId,
    umbrellaSpecId: operation.umbrellaSpecId,
    capability: operation.capability,
    participantOrder: operation.participantOrder,
    participants: (operation.participants ?? []).map((participant) => ({
      component: participant.component,
      repoLocalSpecId: participant.repoLocalSpecId,
      repoLocalWorkItem: participant.repoLocalWorkItem,
      repository: participant.repository,
      targetVersion: participant.targetVersion,
      targetBranch: participant.targetBranch,
      prerequisites: participant.prerequisites,
    })),
    releaseEvidence: (operation.releaseEvidence ?? []).map(({ id }) => id),
  };
}

export function calculateOperationDigest(operation) {
  return `sha256:${createHash('sha256').update(canonicalize(operationIntent(operation))).digest('hex')}`;
}

export function validateOperation(operation) {
  const errors = [];
  if (operation?.schemaVersion !== '1.0.0') errors.push('schemaVersion must be 1.0.0');
  if (operation?.kind !== 'openplanr-ecosystem-operation') {
    errors.push('kind must be openplanr-ecosystem-operation');
  }
  if (operation?.protocolVersion !== '1.2.0') {
    errors.push('protocolVersion must be 1.2.0');
  }
  if (!/^OPERATE-SPEC-[0-9]{3,}$/.test(operation?.operationId ?? '')) {
    errors.push('operationId must use OPERATE-SPEC-NNN');
  }
  if (!digestPattern.test(operation?.operationDigest ?? '')) {
    errors.push('operationDigest must be sha256');
  } else if (operation.operationDigest !== calculateOperationDigest(operation)) {
    errors.push('operationDigest does not match the canonical operation intent');
  }
  const operationSpecId = operation?.operationId?.replace(/^OPERATE-/, '');
  if (
    !/^SPEC-[0-9]{3,}$/.test(operation?.umbrellaSpecId ?? '')
    || operation.umbrellaSpecId !== operationSpecId
  ) {
    errors.push('umbrellaSpecId must match the operation SPEC ID');
  }
  if (!states.has(operation?.state)) errors.push(`unsupported operation state: ${operation?.state}`);
  if (!isDateTime(operation?.createdAt) || !isDateTime(operation?.updatedAt)) {
    errors.push('createdAt and updatedAt must be ISO-8601 timestamps');
  } else if (Date.parse(operation.updatedAt) < Date.parse(operation.createdAt)) {
    errors.push('updatedAt cannot precede createdAt');
  }
  if (operation?.ledger?.kind !== 'marketplace-draft-pr') {
    errors.push('ledger.kind must be marketplace-draft-pr');
  }
  if (operation?.ledger?.repository !== 'openplanr/marketplace') {
    errors.push('the draft ledger must live in openplanr/marketplace');
  }
  if (!/^ecosystem-release\//.test(operation?.ledger?.headRef ?? '')) {
    errors.push('ledger.headRef must use ecosystem-release/');
  }
  if (JSON.stringify(operation?.participantOrder) !== JSON.stringify(participantOrder)) {
    errors.push(`participantOrder must be ${participantOrder.join(' -> ')}`);
  }
  if (!Array.isArray(operation?.participants) || operation.participants.length !== 4) {
    errors.push('exactly four ecosystem participants are required');
  } else {
    const seen = new Set();
    for (const [index, participant] of operation.participants.entries()) {
      const expected = participantOrder[index];
      if (participant?.component !== expected) {
        errors.push(`participant ${index + 1} must be ${expected}`);
      }
      if (participant?.repoLocalSpecId !== `${operation.operationId}:${expected}`) {
        errors.push(`${expected} repoLocalSpecId must link the operation and participant`);
      }
      const expectedWorkItem = repoLocalWorkItems[operation.umbrellaSpecId]?.[expected];
      if (!expectedWorkItem) {
        errors.push(`unsupported repo-local work-item map: ${operation.umbrellaSpecId}`);
      } else if (participant?.repoLocalWorkItem !== expectedWorkItem) {
        errors.push(
          `${expected} repoLocalWorkItem must be ${expectedWorkItem}`,
        );
      }
      const workspaceRoot = process.env.OPENPLANR_ECOSYSTEM_ROOT;
      const workItemRoot =
        expected === 'marketplace'
          ? root
          : workspaceRoot
            ? join(resolve(workspaceRoot), repositoryDirectories[expected])
            : null;
      if (
        workItemRoot &&
        expectedWorkItem
        && !existsSync(join(workItemRoot, expectedWorkItem))
      ) {
        errors.push(
          `${expected} repoLocalWorkItem does not exist: ${expectedWorkItem}`,
        );
      }
      if (seen.has(participant?.component)) {
        errors.push(`duplicate participant: ${participant?.component}`);
      }
      seen.add(participant?.component);
      if (participant?.repository !== repositories[participant?.component]) {
        errors.push(`${participant?.component} repository is not canonical`);
      }
      if (!semverPattern.test(participant?.currentVersion ?? '')) {
        errors.push(`${participant?.component} currentVersion is not semver`);
      }
      if (!semverPattern.test(participant?.targetVersion ?? '')) {
        errors.push(`${participant?.component} targetVersion is not semver`);
      }
      if (!phases.has(participant?.phase)) {
        errors.push(`${participant?.component} has unsupported phase ${participant?.phase}`);
      }
      if (!participant?.targetBranch) {
        errors.push(`${participant?.component} requires targetBranch`);
      }
      if (!participant?.nextSafeAction) {
        errors.push(`${participant?.component} requires nextSafeAction`);
      }
      for (const prerequisite of participant?.prerequisites ?? []) {
        if (!participantOrder.slice(0, index).includes(prerequisite)) {
          errors.push(`${participant?.component} has invalid prerequisite ${prerequisite}`);
        }
      }
      if (participant?.package && participant.package.version !== participant.targetVersion) {
        errors.push(`${participant?.component} package version must equal targetVersion`);
      }
      if (
        participant?.tarballDigest !== null &&
        !digestPattern.test(participant?.tarballDigest ?? '')
      ) {
        errors.push(`${participant?.component} tarballDigest must be null or sha256`);
      }
      for (const approval of participant?.approvals ?? []) {
        if (
          !['plan', 'prepare', 'promote', 'release'].includes(approval?.gate) ||
          approval?.status !== 'approved' ||
          !isDateTime(approval?.timestamp) ||
          !digestPattern.test(approval?.digest ?? '')
        ) {
          errors.push(`${participant?.component} contains an invalid approval`);
        }
        if (approval?.digest !== operation.operationDigest) {
          errors.push(`${participant?.component} approval does not bind operationDigest`);
        }
      }
      if (['published', 'verified'].includes(participant?.phase)) {
        if (participant?.package && !['published', 'verified'].includes(participant.package.status)) {
          errors.push(`${participant?.component} is ${participant.phase} without a published package`);
        }
        if (!participant?.tag) {
          errors.push(`${participant?.component} phase ${participant.phase} requires tag`);
        }
        if (participant?.package && !digestPattern.test(participant?.tarballDigest ?? '')) {
          errors.push(`${participant?.component} phase ${participant.phase} requires tarballDigest`);
        }
      }
      if (['prepared', 'promoting', 'merged', 'published', 'verified'].includes(participant?.phase)) {
        if (!/^[a-f0-9]{40}$/.test(participant?.commitSha ?? '')) {
          errors.push(`${participant?.component} phase ${participant.phase} requires commitSha`);
        }
        if (!participant?.pullRequest) {
          errors.push(`${participant?.component} phase ${participant.phase} requires pullRequest`);
        }
      }
      for (const check of participant?.checks ?? []) {
        if (!check?.name || !['expected', 'pending', 'passed', 'failed', 'skipped'].includes(check.status)) {
          errors.push(`${participant?.component} contains an invalid check`);
        }
      }
    }
  }
  if (operation?.prepareDigest !== null && !digestPattern.test(operation?.prepareDigest ?? '')) {
    errors.push('prepareDigest must be null or sha256');
  }
  if (
    operation?.confirmationDigest !== null &&
    !digestPattern.test(operation?.confirmationDigest ?? '')
  ) {
    errors.push('confirmationDigest must be null or sha256');
  }
  if (['prepared', 'promoting', 'completed', 'verified'].includes(operation?.state)) {
    if (!digestPattern.test(operation?.prepareDigest ?? '')) {
      errors.push(`${operation.state} operation requires prepareDigest`);
    }
    if (!digestPattern.test(operation?.confirmationDigest ?? '')) {
      errors.push(`${operation.state} operation requires confirmationDigest`);
    }
  }
  if (!operation?.nextSafeAction) errors.push('operation requires nextSafeAction');
  for (const error of validateOperatingCanaryEvidence(operation?.releaseEvidence, {
    requirePassed: operation?.state === 'verified',
  })) {
    errors.push(`operating canary: ${error}`);
  }
  const reconciliationSources = [
    'github-pr',
    'git-commit',
    'git-tag',
    'github-checks',
    'npm-registry',
    'marketplace-manifest',
    'operating-canary',
  ];
  if (
    JSON.stringify([...(operation?.reconciliation?.sources ?? [])].sort()) !==
    JSON.stringify([...reconciliationSources].sort())
  ) {
    errors.push('reconciliation must cover PR, commit, tag, CI, npm, and manifest state');
  }
  if (!['pending', 'matched', 'incomplete', 'drift'].includes(operation?.reconciliation?.status)) {
    errors.push('reconciliation status is invalid');
  }
  if (!operation?.reconciliation?.nextSafeAction) {
    errors.push('reconciliation requires nextSafeAction');
  }
  if (!['compensate-before-publish', 'forward-fix'].includes(operation?.recovery?.mode)) {
    errors.push('recovery mode is invalid');
  }
  if (!operation?.recovery?.nextSafeAction) errors.push('recovery requires nextSafeAction');
  const hasPublishedPackage = operation?.participants?.some(({ package: publishedPackage }) =>
    ['published', 'verified'].includes(publishedPackage?.status),
  );
  if (hasPublishedPackage) {
    if (operation?.recovery?.mode !== 'forward-fix') {
      errors.push('published packages require forward-fix recovery');
    }
    const forbiddenCompensation = operation.participants.filter(({ compensation }) =>
      ['close-pr', 'revert-pr', 'deprecate-package'].includes(compensation),
    );
    if (forbiddenCompensation.length) {
      errors.push('published packages forbid compensating rollback; use forward-fix');
    }
  }
  if (operation?.state === 'completed' || operation?.state === 'verified') {
    if (!operation.participants?.every(({ phase }) => phase === 'verified')) {
      errors.push(`${operation.state} operation requires every participant to be verified`);
    }
    if (operation?.ledger?.pullRequest?.state !== 'merged') {
      errors.push(`${operation.state} operation requires a merged marketplace ledger PR`);
    }
  }
  if (operation?.state === 'verified') {
    if (operation?.reconciliation?.status !== 'matched') {
      errors.push('verified operation requires matched live-state reconciliation');
    }
    for (const participant of operation.participants ?? []) {
      if (!participant.approvals?.some(({ gate }) => gate === 'release')) {
        errors.push(`verified operation requires release approval for ${participant.component}`);
      }
      if (participant.pullRequest?.state !== 'merged') {
        errors.push(`verified operation requires merged PR for ${participant.component}`);
      }
      if (!participant.checks?.length || participant.checks.some(({ status }) => status !== 'passed')) {
        errors.push(`verified operation requires passed CI checks for ${participant.component}`);
      }
      if (!participant.tag) {
        errors.push(`verified operation requires a tag for ${participant.component}`);
      }
      if (!digestPattern.test(participant.tarballDigest ?? '')) {
        errors.push(`verified operation requires tarballDigest for ${participant.component}`);
      }
      if (
        participant.package &&
        (participant.package.status !== 'verified' || !participant.package.integrity)
      ) {
        errors.push(`verified operation requires verified npm state for ${participant.component}`);
      }
    }
    if (
      operation.releaseEvidence?.map(({ id }) => id).join(',') !==
      REQUIRED_OPERATING_CANARY_EVIDENCE.join(',')
    ) {
      errors.push('verified operation is missing the canonical operating canary evidence set');
    }
    const reconciliationEventIndex = (operation.history ?? []).findIndex(
      ({ type }) => type === 'reconciliation.recorded',
    );
    const verificationEventIndex = (operation.history ?? []).findIndex(
      ({ type }) => type === 'operation.verified',
    );
    if (reconciliationEventIndex === -1) {
      errors.push('verified operation requires a reconciliation.recorded history event');
    }
    if (verificationEventIndex === -1) {
      errors.push('verified operation requires an operation.verified history event');
    }
    if (
      reconciliationEventIndex >= 0 &&
      verificationEventIndex >= 0 &&
      verificationEventIndex <= reconciliationEventIndex
    ) {
      errors.push('operation.verified must follow reconciliation.recorded');
    }
  }
  for (const event of operation?.history ?? []) {
    if (!event?.eventId || !isDateTime(event?.timestamp) || !digestPattern.test(event?.digest ?? '')) {
      errors.push('history contains an invalid event');
    }
  }
  return errors;
}

export function isVerifiedOperation(operation) {
  return operation?.state === 'verified' && validateOperation(operation).length === 0;
}

export function validateOperationFile(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return [`missing operation ledger: ${absolute}`];
  try {
    return validateOperation(JSON.parse(readFileSync(absolute, 'utf8')));
  } catch (error) {
    return [`cannot parse ${absolute}: ${error.message}`];
  }
}

function defaultFiles() {
  const directories = [join(root, 'examples'), join(root, 'operations')];
  return directories.flatMap((directory) =>
    existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => name.endsWith('.json'))
          .map((name) => join(directory, name))
      : [],
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  const targets = files.length ? files : defaultFiles();
  const failures = [];
  for (const path of targets) {
    for (const error of validateOperationFile(path)) failures.push(`${path}: ${error}`);
  }
  if (failures.length) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write(`Validated ${targets.length} ecosystem operation ledger(s)\n`);
}
