import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_OPERATING_CANARY_EVIDENCE = Object.freeze([
  'packed-cli',
  'protocol-v1.2',
  'event-replay',
  'security-boundaries',
  'outcome-reconciliation',
]);

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const statuses = new Set(['pending', 'passed', 'failed']);

function isDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isCanaryRunUrl(value) {
  return (
    typeof value === 'string' &&
    /^https:\/\/github\.com\/openplanr\/marketplace\/actions\/runs\/[0-9]+(?:[/?#].*)?$/.test(
      value,
    )
  );
}

export function validateOperatingCanaryEvidence(entries, { requirePassed = false } = {}) {
  const errors = [];
  if (!Array.isArray(entries)) return ['releaseEvidence must be an array'];

  const observedIds = entries.map((entry) => entry?.id);
  if (
    JSON.stringify(observedIds) !==
    JSON.stringify(REQUIRED_OPERATING_CANARY_EVIDENCE)
  ) {
    errors.push(
      `releaseEvidence must be ordered as ${REQUIRED_OPERATING_CANARY_EVIDENCE.join(' -> ')}`,
    );
  }

  const seen = new Set();
  for (const entry of entries) {
    if (!REQUIRED_OPERATING_CANARY_EVIDENCE.includes(entry?.id)) {
      errors.push(`unsupported release evidence: ${entry?.id ?? 'missing'}`);
      continue;
    }
    if (seen.has(entry.id)) errors.push(`duplicate release evidence: ${entry.id}`);
    seen.add(entry.id);
    if (!statuses.has(entry.status)) {
      errors.push(`${entry.id} has invalid evidence status ${entry.status}`);
      continue;
    }
    if (entry.status === 'pending') {
      if (entry.url !== null || entry.digest !== null || entry.checkedAt !== null) {
        errors.push(`${entry.id} pending evidence cannot claim a URL, digest, or timestamp`);
      }
    } else {
      if (!isCanaryRunUrl(entry.url)) {
        errors.push(`${entry.id} requires an OpenPlanr marketplace canary run URL`);
      }
      if (!digestPattern.test(entry.digest ?? '')) {
        errors.push(`${entry.id} requires a sha256 evidence digest`);
      }
      if (!isDateTime(entry.checkedAt)) {
        errors.push(`${entry.id} requires an ISO-8601 checkedAt timestamp`);
      }
    }
    if (requirePassed && entry.status !== 'passed') {
      errors.push(`${entry.id} must pass before the operation can be verified`);
    }
  }
  return errors;
}

function parseArguments(argv) {
  const options = { directory: null, output: null, url: null, checkedAt: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--directory') options.directory = value;
    else if (argument === '--output') options.output = value;
    else if (argument === '--url') options.url = value;
    else if (argument === '--checked-at') options.checkedAt = value;
    else throw new Error(`Unknown canary-report option: ${argument}`);
    index += 1;
  }
  if (!options.directory || !options.output || !options.url) {
    throw new Error(
      'Usage: operating-canary-evidence.mjs --directory <logs> --output <report.json> --url <run-url> [--checked-at <ISO-8601>]',
    );
  }
  return options;
}

export function createOperatingCanaryReport({
  directory,
  url,
  checkedAt = new Date().toISOString(),
}) {
  const evidence = REQUIRED_OPERATING_CANARY_EVIDENCE.map((id) => {
    const bytes = readFileSync(join(directory, `${id}.log`));
    if (bytes.length === 0) throw new Error(`${id}.log is empty`);
    return {
      id,
      status: 'passed',
      url,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      checkedAt,
      artifact: basename(`${id}.log`),
    };
  });
  const validationEntries = evidence.map(({ artifact: _artifact, ...entry }) => entry);
  const errors = validateOperatingCanaryEvidence(validationEntries, { requirePassed: true });
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    schemaVersion: '1.0.0',
    kind: 'openplanr-operating-canary-report',
    checkedAt,
    runUrl: url,
    evidence,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = createOperatingCanaryReport({
      directory: resolve(options.directory),
      url: options.url,
      checkedAt: options.checkedAt ?? undefined,
    });
    writeFileSync(resolve(options.output), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Wrote ${report.evidence.length} operating canary evidence records\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
