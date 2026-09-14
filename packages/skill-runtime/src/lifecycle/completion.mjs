import { assertNonBlank, freezeJson, immutableJson } from './internal.mjs';

export const COMPLETION_STATUSES = Object.freeze([
  'completed',
  'partial',
  'blocked',
  'unavailable',
  'cancelled',
]);

const STATUS_SET = new Set(COMPLETION_STATUSES);
const CHECK_STATUSES = new Set(['passed', 'failed', 'not-run']);

function normalizeCheck(check, index) {
  if (!check || typeof check !== 'object' || Array.isArray(check)) {
    throw new TypeError(`checks[${index}] must be an object.`);
  }
  assertNonBlank(check.name, `checks[${index}].name`);
  if (!CHECK_STATUSES.has(check.status)) {
    throw new TypeError(`checks[${index}].status must be passed, failed, or not-run.`);
  }
  return {
    name: check.name,
    status: check.status,
    ...(check.detail === undefined ? {} : { detail: assertNonBlank(check.detail, `checks[${index}].detail`) }),
  };
}

function normalizeIssue(issue, index) {
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
    throw new TypeError(`issues[${index}] must be an object.`);
  }
  return {
    problem: assertNonBlank(issue.problem, `issues[${index}].problem`),
    impact: assertNonBlank(issue.impact, `issues[${index}].impact`),
    nextAction: assertNonBlank(issue.nextAction, `issues[${index}].nextAction`),
  };
}

/** Build the concise runtime result shared by lifecycle-enabled skills. */
export function createCompletion({
  status,
  summary,
  checks = [],
  issues = [],
  output,
} = {}) {
  if (!STATUS_SET.has(status)) throw new TypeError(`Unknown completion status: ${status}.`);
  assertNonBlank(summary, 'summary');
  if (!Array.isArray(checks)) throw new TypeError('checks must be an array.');
  if (!Array.isArray(issues)) throw new TypeError('issues must be an array.');

  const normalizedChecks = checks.map(normalizeCheck);
  const normalizedIssues = issues.map(normalizeIssue);
  if (status === 'completed') {
    if (normalizedChecks.some((check) => check.status !== 'passed')) {
      throw new TypeError('completed results require every reported check to pass.');
    }
    if (normalizedIssues.length > 0) {
      throw new TypeError('completed results cannot contain unresolved issues.');
    }
  }

  return freezeJson({
    status,
    summary,
    checks: normalizedChecks,
    issues: normalizedIssues,
    ...(output === undefined ? {} : { output: immutableJson(output, 'output') }),
  });
}

/**
 * Normalize a structurally typed resolver result without coupling lifecycle to
 * one host adapter. Denial remains a resolver diagnostic and becomes an
 * unavailable completion, never an invented execution result.
 */
export function completionFromRuntimeResult(result, {
  summary,
  checks = [],
  issues = [],
} = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('result must be a runtime result object.');
  }
  const status = result.status === 'denied' ? 'unavailable' : result.status;
  if (!STATUS_SET.has(status)) throw new TypeError(`Unsupported runtime result status: ${result.status}.`);
  return createCompletion({
    status,
    summary,
    checks,
    issues,
    output: result,
  });
}
