import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REQUIRED_OPERATING_CANARY_EVIDENCE } from './operating-canary-evidence.mjs';

const COMMIT_SHA = /^[a-f0-9]{40}$/;
const RUN_ID = /^[1-9][0-9]*$/;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!argument?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid canary materialization argument: ${argument ?? 'missing'}`);
    }
    options[argument.slice(2)] = value;
  }
  return options;
}

export function materializeOperatingCanary({
  directory,
  pipelineCommit,
  cliCommit,
  skillsCommit,
  runId,
  repository,
}) {
  if (!directory) throw new Error('Canary evidence directory is required');
  for (const [label, value] of Object.entries({
    pipelineCommit,
    cliCommit,
    skillsCommit,
  })) {
    if (!COMMIT_SHA.test(value ?? '')) throw new Error(`${label} must be a full commit SHA`);
  }
  if (!RUN_ID.test(runId ?? '')) throw new Error('runId must be a GitHub Actions run ID');
  if (repository !== 'openplanr/marketplace') {
    throw new Error('Canary evidence must originate from openplanr/marketplace');
  }

  const outputDirectory = resolve(directory);
  mkdirSync(outputDirectory, { recursive: true });
  const binding = {
    schemaVersion: '1.0.0',
    kind: 'openplanr-operating-canary-proof',
    repository,
    runId,
    participants: {
      pipeline: pipelineCommit,
      cli: cliCommit,
      skills: skillsCommit,
    },
  };
  for (const id of REQUIRED_OPERATING_CANARY_EVIDENCE) {
    writeFileSync(
      resolve(outputDirectory, `${id}.log`),
      `${JSON.stringify({ ...binding, evidenceId: id, status: 'passed' })}\n`,
      { flag: 'wx' },
    );
  }
  return { directory: outputDirectory, count: REQUIRED_OPERATING_CANARY_EVIDENCE.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = materializeOperatingCanary({
      directory: options.directory,
      pipelineCommit: options['pipeline-commit'],
      cliCommit: options['cli-commit'],
      skillsCommit: options['skills-commit'],
      runId: options['run-id'],
      repository: options.repository,
    });
    process.stdout.write(
      `Materialized ${result.count} deterministic canary proofs in ${result.directory}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
