#!/usr/bin/env node
// Run the Workspace CI job commands locally, in order, on the current Node version.
// Usage: node scripts/run-ci-parity.mjs [--only <id,...>] [--skip <id,...>] [--list]
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'packages/cli');

// Mirrors .github/workflows/ci.yml; keep the two in step when a job changes.
const JOBS = [
  {
    id: 'quality',
    title: 'generated, boundary, lint, and build verification',
    steps: [
      ['npm', ['run', 'generate']],
      ['git', ['diff', '--exit-code', 'HEAD', '--']],
      ['npm', ['run', 'check:generated']],
      ['npm', ['run', 'check:boundaries']],
      ['npm', ['run', 'check:preservation']],
      ['npm', ['run', 'check:docs']],
      ['npm', ['run', 'lint']],
      ['npm', ['run', 'build']],
      ['git', ['diff', '--exit-code', 'HEAD', '--']],
      ['npm', ['run', 'check:diagrams']],
      ['npm', ['run', 'test:focused']],
    ],
  },
  {
    id: 'supporting',
    title: 'supporting package tests',
    steps: [
      '@openplanr/protocol',
      '@openplanr/operate',
      '@openplanr/artifact',
      '@openplanr/integrations',
      '@openplanr/skill-runtime',
      '@openplanr/dashboard-app',
    ].map((workspace) => ['npm', ['test', `--workspace=${workspace}`]]),
  },
  {
    id: 'design',
    title: 'design package tests',
    steps: [['npm', ['test', '--workspace=@openplanr/design']]],
  },
  {
    id: 'pipeline',
    title: 'pipeline suites',
    steps: [
      'test:surface',
      'test:orchestration:runtime',
      'test:orchestration:ecosystem',
      'test:orchestration:pipeline',
    ].map((script) => ['npm', ['run', script, '--workspace=planr-pipeline']]),
  },
  {
    id: 'cli',
    title: 'CLI tests (all shards, Operate boundary and runtime integrity)',
    cwd: cli,
    steps: [['npx', ['--no-install', 'vitest', 'run', '--maxWorkers=1']]],
  },
  {
    id: 'cli-heavy',
    title: 'CLI heavy tests',
    cwd: cli,
    steps: [
      ['npm', ['run', 'test:heavy']],
      [
        'npx',
        [
          '--no-install',
          'vitest',
          'run',
          'tests/integration/operate-lifecycle.test.ts',
          'tests/integration/dashboard-operate-cycles.test.ts',
          '--maxWorkers=1',
          '--testTimeout=600000',
        ],
      ],
    ],
  },
  {
    id: 'packed',
    title: 'packed public-package proof',
    steps: [['npm', ['run', 'verify:packed:strict']]],
  },
];

const args = process.argv.slice(2);
const list = (name) => {
  const index = args.indexOf(name);
  return index === -1
    ? null
    : new Set(
        args[index + 1]
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
};
const only = list('--only');
const skip = list('--skip') ?? new Set();
if (args.includes('--list')) {
  for (const job of JOBS) console.log(`${job.id.padEnd(12)} ${job.title}`);
  process.exit(0);
}
for (const id of [...(only ?? []), ...skip]) {
  if (!JOBS.some((job) => job.id === id)) throw new Error(`Unknown CI job id: ${id}`);
}

const results = [];
const startedAt = Date.now();
for (const job of JOBS) {
  if ((only && !only.has(job.id)) || skip.has(job.id)) {
    results.push({ id: job.id, status: 'skipped' });
    continue;
  }
  console.log(`\n=== ${job.id}: ${job.title} ===`);
  const jobStart = Date.now();
  let failure = null;
  for (const [command, commandArgs] of job.steps) {
    console.log(`$ ${command} ${commandArgs.join(' ')}`);
    const run = spawnSync(command, commandArgs, {
      cwd: job.cwd ?? root,
      stdio: 'inherit',
      env: { ...process.env, CI: '1' },
    });
    if (run.status !== 0) {
      failure = `${command} ${commandArgs.join(' ')} exited with ${run.status ?? run.signal}`;
      break;
    }
  }
  results.push({
    id: job.id,
    status: failure ? 'failed' : 'passed',
    seconds: Math.round((Date.now() - jobStart) / 1000),
    failure,
  });
  if (failure) break;
}

console.log('\n=== verify:ci summary ===');
for (const result of results) {
  console.log(
    `${result.status.padEnd(8)} ${result.id}${result.seconds ? ` (${result.seconds}s)` : ''}${result.failure ? ` — ${result.failure}` : ''}`,
  );
}
const ran = results.filter((result) => result.status !== 'skipped');
const failed = results.find((result) => result.status === 'failed');
console.log(
  `${ran.length} job(s) ran in ${Math.round((Date.now() - startedAt) / 1000)}s on Node ${process.version}; CI also runs the compatibility matrix on Node 20 and 22.`,
);
if (failed) process.exit(1);
const notRun = JOBS.filter((job) => !ran.some((result) => result.id === job.id));
if (notRun.length) console.log(`Not run: ${notRun.map((job) => job.id).join(', ')}`);
