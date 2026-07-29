import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateOperatingCanaryEvidence } from './operating-canary-evidence.mjs';

function observedParticipant(liveState, component) {
  return liveState?.participants?.find((participant) => participant.component === component);
}

function compareValue(drift, path, expected, actual) {
  if (expected !== null && expected !== undefined && expected !== actual) {
    drift.push(`${path}: expected ${expected}, observed ${actual ?? 'missing'}`);
  }
}

export function reconcileOperation(operation, liveState) {
  if (!liveState || !Array.isArray(liveState.participants)) {
    throw new Error('Authoritative live-state snapshot is required; the draft ledger is audit-only.');
  }

  const drift = [];
  const incomplete = [];
  for (const expected of operation.participants) {
    const live = observedParticipant(liveState, expected.component);
    if (!live) {
      incomplete.push(`${expected.component}: live participant state is missing`);
      continue;
    }

    compareValue(drift, `${expected.component}.repository`, expected.repository, live.repository);
    compareValue(drift, `${expected.component}.targetBranch`, expected.targetBranch, live.targetBranch);
    compareValue(drift, `${expected.component}.commitSha`, expected.commitSha, live.commitSha);
    if (expected.pullRequest) {
      compareValue(
        drift,
        `${expected.component}.pullRequest.number`,
        expected.pullRequest.number,
        live.pullRequest?.number,
      );
      compareValue(
        drift,
        `${expected.component}.pullRequest.state`,
        expected.pullRequest.state,
        live.pullRequest?.state,
      );
      compareValue(
        drift,
        `${expected.component}.pullRequest.baseBranch`,
        expected.targetBranch,
        live.pullRequest?.baseBranch,
      );
      compareValue(
        drift,
        `${expected.component}.pullRequest.mergeCommitSha`,
        expected.commitSha,
        live.pullRequest?.mergeCommitSha,
      );
    }
    if (expected.tag) {
      compareValue(drift, `${expected.component}.tag.name`, expected.tag, live.tag?.name);
      compareValue(
        drift,
        `${expected.component}.tag.commitSha`,
        expected.commitSha,
        live.tag?.commitSha,
      );
    }
    if (expected.tarballDigest) {
      compareValue(
        drift,
        `${expected.component}.tarballDigest`,
        expected.tarballDigest,
        live.tarballDigest,
      );
    }
    for (const expectedCheck of expected.checks) {
      const liveCheck = live.checks?.find(({ name }) => name === expectedCheck.name);
      if (!liveCheck) {
        incomplete.push(`${expected.component}.checks.${expectedCheck.name}: missing`);
      } else {
        compareValue(
          drift,
          `${expected.component}.checks.${expectedCheck.name}`,
          expectedCheck.status,
          liveCheck.status,
        );
      }
    }
    if (expected.package) {
      if (expected.package.status === 'pending') {
        if (live.package?.version === expected.package.version) {
          drift.push(
            `${expected.component}.package: target version exists in the registry while the ledger is pending`,
          );
        }
      } else if (!live.package) {
        incomplete.push(`${expected.component}.package: registry state is missing`);
      } else {
        compareValue(
          drift,
          `${expected.component}.package.name`,
          expected.package.name,
          live.package.name,
        );
        compareValue(
          drift,
          `${expected.component}.package.version`,
          expected.package.version,
          live.package.version,
        );
        compareValue(
          drift,
          `${expected.component}.package.integrity`,
          expected.package.integrity,
          live.package.integrity,
        );
      }
    }
  }

  const shouldReconcileCanary =
    operation.state === 'verified' ||
    operation.releaseEvidence?.some(({ status }) => status !== 'pending');
  if (shouldReconcileCanary) {
    if (!Array.isArray(liveState.releaseEvidence)) {
      incomplete.push('operating canary evidence is missing');
    } else {
      for (const error of validateOperatingCanaryEvidence(liveState.releaseEvidence, {
        requirePassed: operation.state === 'verified',
      })) {
        drift.push(`operating canary: ${error}`);
      }
      for (const expectedEvidence of operation.releaseEvidence ?? []) {
        const observedEvidence = liveState.releaseEvidence.find(
          ({ id }) => id === expectedEvidence.id,
        );
        if (!observedEvidence) {
          incomplete.push(`releaseEvidence.${expectedEvidence.id}: missing`);
          continue;
        }
        compareValue(
          drift,
          `releaseEvidence.${expectedEvidence.id}.status`,
          expectedEvidence.status,
          observedEvidence.status,
        );
        compareValue(
          drift,
          `releaseEvidence.${expectedEvidence.id}.url`,
          expectedEvidence.url,
          observedEvidence.url,
        );
        compareValue(
          drift,
          `releaseEvidence.${expectedEvidence.id}.digest`,
          expectedEvidence.digest,
          observedEvidence.digest,
        );
      }
    }
  }

  const manifestTargets = Object.fromEntries(
    operation.participants.map(({ component, targetVersion }) => [component, targetVersion]),
  );
  if (liveState.manifest) {
    for (const [component, targetVersion] of Object.entries(manifestTargets)) {
      compareValue(
        drift,
        `manifest.components.${component}`,
        targetVersion,
        liveState.manifest.components?.[component],
      );
    }
    if (operation.state === 'verified') {
      compareValue(
        drift,
        'manifest.capabilities.operatingBoard.status',
        'available',
        liveState.manifest.operatingBoardStatus,
      );
    }
  } else {
    incomplete.push('marketplace manifest state is missing');
  }

  const status = drift.length ? 'drift' : incomplete.length ? 'incomplete' : 'matched';
  const nextSafeAction =
    status === 'matched'
      ? operation.nextSafeAction
      : status === 'incomplete'
        ? `Collect missing live state before resuming: ${incomplete[0]}`
        : `Stop promotion and reconcile drift before resuming: ${drift[0]}`;

  return {
    operationId: operation.operationId,
    checkedAt: liveState.checkedAt ?? new Date().toISOString(),
    status,
    drift,
    incomplete,
    nextSafeAction,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operationPath, liveStatePath] = process.argv.slice(2);
  if (!operationPath || !liveStatePath) {
    process.stderr.write(
      'Usage: node scripts/reconcile-operation.mjs <operation.json> <authoritative-live-state.json>\n',
    );
    process.exit(1);
  }
  const operation = JSON.parse(readFileSync(operationPath, 'utf8'));
  const liveState = JSON.parse(readFileSync(liveStatePath, 'utf8'));
  const result = reconcileOperation(operation, liveState);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'matched') process.exitCode = 2;
}
