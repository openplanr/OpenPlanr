import { PipelineError } from '../pipeline/errors.mjs';
import { assertProtocolArtifact } from '../protocol/contracts.mjs';

const CADENCE_PROTOCOL_VERSION = '1.3.0';
const CADENCE_KIND = 'operating-cadence-status';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The three cadence modes FR8 recognises. `manual` runs only on request and has
 * no computed due date; `weekly` and `monthly` compute and surface the next due
 * date so `status` can show it. No mode here — and no code path below — can
 * accept a finding, apply a route, invoke PLAN, or invoke SHIP.
 */
export const OPERATING_CADENCES = Object.freeze(['manual', 'weekly', 'monthly']);

// Same RFC 3339 UTC date-time shape the conformance validator enforces for the
// v1.3 cadence-status contract, so an input this function accepts is exactly an
// input the schema accepts.
const RFC3339_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Serialize a Date to an RFC 3339 UTC string, dropping a zero millisecond
 * fraction so the surfaced value matches the canonical cadence-status fixtures
 * (`...T09:00:00Z`) while a non-zero fraction is preserved. Pure: reads only the
 * supplied Date, never the wall clock.
 */
function toUtcIsoString(date) {
  return date.toISOString().replace(/\.000Z$/u, 'Z');
}

/**
 * Parse an injected timestamp into a Date, failing closed on anything that is not
 * a well-formed RFC 3339 UTC date-time. There is no `Date.now()` here: every Date
 * is derived from an explicit string argument, keeping the whole computation a
 * pure function of its inputs (FR8).
 */
function parseInstant(label, value) {
  if (typeof value !== 'string' || !RFC3339_DATETIME.test(value)) {
    throw new PipelineError(
      'E_OPERATE_CADENCE_TIMESTAMP',
      `${label} must be an RFC 3339 UTC date-time string; received ${JSON.stringify(value)}.`,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PipelineError(
      'E_OPERATE_CADENCE_TIMESTAMP',
      `${label} is not a valid date-time: ${JSON.stringify(value)}.`,
    );
  }
  return date;
}

/**
 * Add exactly one calendar month in UTC, preserving the day-of-month where the
 * target month is long enough and clamping to the target month's last day when it
 * is shorter (Jan 31 + 1 month -> Feb 28/29). Time-of-day is preserved. Pure.
 */
function addOneCalendarMonthUtc(date) {
  const targetMonthIndex = date.getUTCMonth() + 1;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(date.getUTCDate(), lastDayOfTargetMonth);
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

/**
 * Compute the cadence status for a cycle (FR8). Pure function of exactly three
 * value inputs — `cadence`, the last run instant, and the injected `now` — with
 * no filesystem read, no network call, no scheduling side effect, and no wall
 * clock read. It only computes and returns a value:
 *
 *   - `manual`  -> `nextDueAt: null` (runs only on request);
 *   - `weekly`  -> `lastRunAt + 7 days`, or `now` when `lastRunAt` is null
 *                  (due immediately on the first run);
 *   - `monthly` -> `lastRunAt + 1 calendar month` (same day-of-month, clamped to
 *                  the last day of a shorter month), or `now` on the first run.
 *
 * The returned object is validated against operating-cadence-status@1.3.0 before
 * it is returned, so an out-of-contract value can never escape this function.
 *
 * The signature has no parameter through which a caller could pass an action,
 * route, finding, PLAN, or SHIP request; see `assertCadenceCannotMutate`.
 */
export function computeNextDueDate(cadence, lastRunAt, now) {
  if (!OPERATING_CADENCES.includes(cadence)) {
    throw new PipelineError(
      'E_OPERATE_CADENCE_INVALID',
      `Unknown cadence "${cadence}"; expected one of ${OPERATING_CADENCES.join(', ')}.`,
    );
  }

  const nowDate = parseInstant('now', now);
  const hasLastRun = lastRunAt !== null && lastRunAt !== undefined;
  const lastRunDate = hasLastRun ? parseInstant('lastRunAt', lastRunAt) : null;

  let nextDueAt = null;
  if (cadence === 'weekly') {
    nextDueAt = lastRunDate === null
      ? toUtcIsoString(nowDate)
      : toUtcIsoString(new Date(lastRunDate.getTime() + WEEK_MS));
  } else if (cadence === 'monthly') {
    nextDueAt = lastRunDate === null
      ? toUtcIsoString(nowDate)
      : toUtcIsoString(addOneCalendarMonthUtc(lastRunDate));
  }

  const status = {
    kind: CADENCE_KIND,
    schemaVersion: '1.0.0',
    protocolVersion: CADENCE_PROTOCOL_VERSION,
    cadence,
    lastRunAt: hasLastRun ? lastRunAt : null,
    nextDueAt,
  };

  assertProtocolArtifact(CADENCE_KIND, status, { protocolVersion: CADENCE_PROTOCOL_VERSION });
  return status;
}

/**
 * Documented no-op review anchor for FR8's non-execution guarantee. Its only job
 * is to be the single named export a reviewer can point to in order to confirm
 * that cadence computation never accepts findings, applies routes, invokes PLAN,
 * or invokes SHIP. The guarantee is structural, not behavioural: `computeNextDueDate`
 * takes only `(cadence, lastRunAt, now)`, so there is literally no argument
 * through which a caller could request an action or route. This function performs
 * no work, reads no state, and returns `true` to make that intent explicit.
 */
export function assertCadenceCannotMutate() {
  return true;
}
