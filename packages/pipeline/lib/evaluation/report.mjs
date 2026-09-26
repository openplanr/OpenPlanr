import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PipelineError } from '../pipeline/errors.mjs';
import { assertEvaluationAggregateReport } from '../pipeline/evaluation-contract.mjs';
import { deriveEvaluationIdentity } from '../pipeline/evaluation-identity.mjs';
import {
  EVALUATION_REDACTION_DECLARATIONS,
  EVALUATION_REDACTION_POLICY_VERSION,
  assertEvaluationAggregatePublishable,
} from '../pipeline/evaluation-redaction.mjs';

/** Files a CI job may publish. Everything else stays in the local run directory. */
export const EVALUATION_CI_ARTIFACTS = Object.freeze([
  'evaluation-aggregate.json',
  'evaluation-junit.xml',
]);

function fail(code, message, fix = '', details = undefined) {
  throw new PipelineError(code, message, fix, details);
}

function seal(record, kind) {
  const derived = deriveEvaluationIdentity(record, kind);
  return { ...record, [derived.idField]: derived.id, [derived.digestField]: derived.digest };
}

const REDACTION = Object.freeze({
  policyVersion: EVALUATION_REDACTION_POLICY_VERSION,
  ...Object.fromEntries(
    EVALUATION_REDACTION_DECLARATIONS.map((declaration) => [declaration, true]),
  ),
});

/**
 * The only publishable projection of a run.
 * It is built from counters, rates, and digests, so there is nothing to strip
 * later; the publish gate then refuses anything that slipped in anyway.
 */
export function buildAggregateReport({
  generatedAt,
  inputs,
  counters,
  rates,
  budget,
  absences,
  skills,
  scenarios,
}) {
  const report = seal(
    {
      kind: 'evaluation-aggregate-report',
      schemaVersion: '1.0.0',
      protocolVersion: '1.4.0',
      reportId: 'ear_00000000000000000000000000000000',
      reportDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      generatedAt,
      redaction: { ...REDACTION },
      inputs,
      counters,
      rates,
      budget,
      absences,
      skills,
      scenarios,
    },
    'evaluation-aggregate-report',
  );
  return assertEvaluationAggregateReport(report);
}

function escapeXml(value) {
  return String(value).replace(
    /[<>&"']/gu,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character],
  );
}

/**
 * JUnit emission from the redacted aggregate only.
 * Case names carry the skill, prompt class, and scenario digest so a reader can
 * find the local evidence without the report carrying any of it.
 */
export function renderJUnit(report) {
  assertEvaluationAggregatePublishable(report, 'junit source');
  const failures = report.scenarios.filter((entry) => entry.status === 'failed').length;
  const skipped = report.scenarios.filter(
    (entry) => entry.status === 'absent' || entry.status === 'blocked',
  ).length;
  const cases = report.scenarios.map((entry) => {
    const name = `${entry.skillId}.${entry.promptClass}.${entry.scenarioDigest.slice(7, 19)}`;
    const open = `    <testcase classname="${escapeXml(entry.skillId)}" name="${escapeXml(name)}" time="${(entry.latencyMs / 1000).toFixed(3)}">`;
    if (entry.status === 'failed')
      return `${open}\n      <failure type="gate">${escapeXml(entry.scenarioDigest)}</failure>\n    </testcase>`;
    if (entry.status === 'absent')
      return `${open}\n      <skipped message="${escapeXml(entry.absenceReason)}"/>\n    </testcase>`;
    if (entry.status === 'blocked')
      return `${open}\n      <skipped message="blocked"/>\n    </testcase>`;
    return `${open}</testcase>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="skill-evaluation" tests="${report.counters.scenariosTotal}" failures="${failures}" skipped="${skipped}">`,
    `  <testsuite name="${escapeXml(report.reportId)}" tests="${report.counters.scenariosTotal}" failures="${failures}" skipped="${skipped}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

/**
 * Raw prompts, traces, and grader output stay here and nowhere else.
 * The local directory is the only place restricted evidence is written.
 */
export function writeLocalRun(
  directory,
  { runResult, aggregateReport, receipts, rawEvidence = [] },
) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'run-result.json'), `${JSON.stringify(runResult, null, 2)}\n`);
  writeFileSync(
    join(directory, 'evaluation-aggregate.json'),
    `${JSON.stringify(aggregateReport, null, 2)}\n`,
  );
  writeFileSync(
    join(directory, 'certification-receipts.json'),
    `${JSON.stringify(receipts, null, 2)}\n`,
  );
  writeFileSync(join(directory, 'raw-evidence.json'), `${JSON.stringify(rawEvidence, null, 2)}\n`);
  return directory;
}

/** The CI report path. Only the redacted aggregate and JUnit are emitted. */
export function writeCiReports(directory, aggregateReport) {
  assertEvaluationAggregatePublishable(aggregateReport, 'ci aggregate report');
  mkdirSync(directory, { recursive: true });
  const written = [];
  writeFileSync(
    join(directory, EVALUATION_CI_ARTIFACTS[0]),
    `${JSON.stringify(aggregateReport, null, 2)}\n`,
  );
  written.push(EVALUATION_CI_ARTIFACTS[0]);
  writeFileSync(join(directory, EVALUATION_CI_ARTIFACTS[1]), renderJUnit(aggregateReport));
  written.push(EVALUATION_CI_ARTIFACTS[1]);
  if (JSON.stringify(written) !== JSON.stringify([...EVALUATION_CI_ARTIFACTS])) {
    fail(
      'E_EVALUATION_PUBLISH_UNSAFE',
      'The CI report path emitted something other than the declared artifacts.',
      'CI publishes the redacted aggregate and JUnit only; raw evidence stays local.',
      { written },
    );
  }
  return Object.freeze([...written]);
}
