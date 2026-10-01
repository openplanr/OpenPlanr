const MAX_VISIBLE_PATHS = 12;

function taskLabel(selector) {
  return selector === undefined
    ? 'Task unavailable'
    : selector
      ? `Task ${selector}`
      : 'Direct request';
}

function visiblePaths(paths = []) {
  const selected = paths.slice(0, MAX_VISIBLE_PATHS);
  const remaining = paths.length - selected.length;
  return remaining
    ? `${selected.join(', ')} (+${remaining} more; inspect changedPaths)`
    : selected.join(', ');
}

export function preparationPresentation(preview) {
  return {
    phase: 'preview',
    headline: `${taskLabel(preview.selector)} is ready for review before dispatch.`,
    context: `${preview.inventory.length} copied file(s); ${preview.omissions.length} omission(s).`,
    writableRepository: preview.writableRepository,
    worktreePath: preview.worktreePath,
    selectedPaths: preview.selectedPaths,
    integrationScopePaths: preview.integrationScopePaths ?? null,
    integrationBoundary: preview.integrationScopePaths?.length
      ? 'Only observed changes within integrationScopePaths may be integrated; the worktree is not a filesystem sandbox.'
      : 'Legacy run has no recorded integration scope; supply explicit paths at review. The worktree is not a filesystem sandbox.',
    inventory: preview.inventory,
    omissions: preview.omissions,
    blockers: preview.blockers ?? [],
    planning: preview.planning ?? null,
    helper: preview.helper ?? null,
    worktreeDependencies: preview.worktreeDependencies,
    timing: preview.preparationTiming ?? null,
    profile: preview.profile,
    destination: preview.destination,
    ...(preview.executionPolicy ? { executionPolicy: preview.executionPolicy } : {}),
    nextAction:
      'Review required sources, optional omissions, planning location, integration scope, and destination before dispatch.',
  };
}

export function handoffPresentation(outcome) {
  const status = outcome.status;
  const headline =
    status === 'completed'
      ? 'Delegate finished; observed-change review and independent checks are still required.'
      : status === 'question'
        ? 'Delegate needs a decision before it can continue.'
        : 'Delegate is blocked; its session and worktree remain inspectable.';
  return {
    phase: 'handoff',
    timing: outcome.record?.executionTiming ?? null,
    status,
    headline,
    ...(status === 'question' && outcome.result?.question
      ? { question: outcome.result.question }
      : {}),
    nextAction:
      outcome.nextAction ??
      (status === 'completed'
        ? 'Inspect the worktree, then run review and apply only after accepting the observed patch.'
        : status === 'question'
          ? 'Answer the question and resume this exact run.'
          : 'Inspect the retained worktree and diagnostic.'),
  };
}

export function reviewPresentation(review) {
  return {
    phase: 'review',
    status: review.ready ? 'ready' : 'blocked',
    headline: review.ready
      ? `${review.changedPaths.length} observed file change(s) ready for human review; nothing has been integrated.`
      : 'Observed changes require attention before integration.',
    changed: visiblePaths(review.changedPaths),
    violations: review.violations.map(({ code, path }) => (path ? `${code}: ${path}` : code)),
    nextAction: review.ready
      ? 'Inspect the retained worktree patch and then call apply with the same scope.'
      : 'Resolve the violations in the retained worktree or source before retrying.',
  };
}

export function implementationReport(result, selector) {
  const accepted = result.status === 'completed';
  const paths = result.changedPaths ?? [];
  const checks = result.checks ?? [];
  const failed = [...checks, ...(result.verification?.preparation ?? [])].filter(
    ({ status }) => status !== 'passed',
  );
  const issues = [
    ...(result.violations ?? []).map(({ code, path }) => (path ? `${code}: ${path}` : code)),
    ...(result.code ? [result.code] : []),
    ...failed.map(({ command, status, exitCode, timeoutMs, classification }) =>
      status === 'timed-out'
        ? `${command} timed out after ${timeoutMs} ms`
        : `${command} failed${exitCode == null ? '' : ` (exit ${exitCode})`}${classification === 'baseline-failure' ? '; also fails before applying this delta' : classification === 'regression' ? '; passes before applying this delta' : ''}`,
    ),
    ...(result.rollbackErrors ?? []).map(({ path, code }) => `Recovery needed: ${path} (${code})`),
    ...(checks.length === 0 ? ['Verification incomplete: no independent checks ran'] : []),
  ];
  return {
    Outcome: accepted
      ? paths.length
        ? 'Integrated as an uncommitted local diff.'
        : 'No observed delta to integrate.'
      : 'Not accepted; inspect the retained worktree and source state.',
    Task: taskLabel(selector),
    Changed: paths.length
      ? `${paths.length} observed file(s) ${accepted ? 'integrated' : 'not accepted'}: ${visiblePaths(paths)}`
      : 'No observed file changes.',
    Checks: checks.length
      ? `${checks.filter(({ status }) => status === 'passed').length}/${checks.length} independent check(s) passed: ${checks
          .map(
            ({ command, status, durationMs }) =>
              `${command} (${status}${
                durationMs === undefined ? '' : `, ${(durationMs / 1000).toFixed(1)}s`
              })`,
          )
          .join(', ')}`
      : 'No independent checks ran; verification remains unconfirmed.',
    Issues: issues.length
      ? `${issues.join('; ')}.${accepted ? '' : ` ${result.nextAction ?? ''}`}`.trim()
      : 'None found in this review.',
  };
}

export function runStatusPresentation(record, integration, processState, verificationInterrupted) {
  if (['applying', 'interrupted'].includes(record.integration?.status))
    return {
      phase: 'integration-recovery',
      nextAction:
        'Source integration is unresolved; run the integration helper recover action for this run before dispatch, resume, review, apply, or abandon.',
    };
  if (integration.recorded) {
    if (integration.driftPaths.length)
      return {
        phase: 'integrated-drift',
        nextAction:
          'Accepted source paths changed after integration; review those edits as separate work before attributing the final diff to the delegate.',
      };
    return {
      phase: 'integrated',
      nextAction:
        record.status === 'closed'
          ? 'Delegated integration is closed; later corrections need a new run or an explicit host-native handoff.'
          : 'The accepted local diff is recorded; close this run as integrated.',
    };
  }
  if (record.verification?.status === 'running')
    return {
      phase: verificationInterrupted ? 'verification-interrupted' : record.verification.phase,
      nextAction: verificationInterrupted
        ? 'Verification process ended before its final evidence; inspect the saved attempt and retry apply before accepting source changes.'
        : `Independent verification is running (${record.verification.phase}); wait for its recorded result before integration.`,
    };
  if (['exited', 'reused', 'deadline-expired'].includes(processState))
    return {
      phase: record.executionTiming?.last?.phase ?? 'delegate-execution',
      nextAction:
        'The dispatch process exited; run recover for this exact run ID and inspect the retained worktree.',
    };
  if (['preparing', 'running', 'resuming'].includes(record.status))
    return {
      phase: record.executionTiming?.last?.phase ?? 'delegate-execution',
      nextAction:
        'Wait for this run ID; if its host process ended, use recover and inspect the retained worktree.',
    };
  const nextActions = {
    completed: 'Review the observed worktree delta and run independent checks before integration.',
    question: 'Answer the structured question, then resume this exact run ID.',
    blocked:
      'Inspect the diagnostic and retained worktree; resume only if the exact session is available.',
    prepared: 'Present the complete preview and verified destination before dispatch.',
  };
  return {
    phase: record.status === 'completed' ? 'review-pending' : record.status,
    nextAction: nextActions[record.status] ?? 'Inspect the retained run record.',
  };
}
