#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the primary journey against the PACKED artifact, the way a user receives
 * it — not against this working tree.
 *
 * Every defect this gate exists to catch shipped through a green suite:
 *
 *   - a pipeline pin that only resolves through `node_modules`, which every test
 *     bypasses by setting OPENPLANR_PIPELINE_ROOT to a source checkout, so
 *     `planr setup` failed on every correctly-installed machine while CI passed
 *   - a mandate that enforced one response contract and disclosed another,
 *     because conformance tested the mandate builder and the brief builder in
 *     isolation and never composed them — the composition is the only place the
 *     bug existed
 *   - a first-command status line advertising a protocol two generations stale
 *
 * The common shape: each part was individually correct and the assembly was not.
 * Unit and contract tests cannot see that. This can, because it installs the
 * tarball into a clean prefix with a clean HOME and then just uses the product.
 *
 * Exit codes
 *   0  the packed artifact performs the journey correctly
 *   1  a journey assertion failed — do not publish
 *   2  the gate itself could not run (pack/install/network) — never silently 0,
 *      because an unrunnable gate must not read as a passing one
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Thrown to end the journey early after a check has already been recorded. */
class JourneyStop extends Error {}
const failures = [];
const notes = [];

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`);
    failures.push(description);
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

let workspace;
try {
  workspace = mkdtempSync(join(tmpdir(), 'openplanr-release-artifact-'));
  const prefix = join(workspace, 'prefix');
  const home = join(workspace, 'home');
  const project = join(workspace, 'project');
  for (const directory of [prefix, home, project]) mkdirSync(directory, { recursive: true });

  console.log('Packing the artifact…');
  const packed = run('npm', ['pack', '--pack-destination', workspace], { cwd: repositoryRoot })
    .trim()
    .split('\n')
    .pop();
  const tarball = join(workspace, packed);

  console.log(`Installing ${packed} into a clean prefix…`);
  writeFileSync(join(prefix, 'package.json'), '{"name":"release-gate","private":true}\n');
  run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: prefix, stdio: 'pipe' });

  const cli = join(prefix, 'node_modules', '.bin', 'planr');
  // A clean HOME is the point: no plugin cache, no prior config, nothing this
  // machine happens to have that a user would not.
  const environment = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.OPENPLANR_PIPELINE_ROOT;
  delete environment.OPENPLANR_ECOSYSTEM_SOURCE;

  const cliOutput = (args, options = {}) =>
    run(cli, args, { cwd: project, env: environment, ...options });

  console.log('\nJourney:');

  // Read manifests off disk rather than through require.resolve: the pipeline's
  // `exports` map deliberately does not expose ./package.json.
  const readManifest = (...segments) =>
    JSON.parse(readFileSync(join(prefix, 'node_modules', ...segments, 'package.json'), 'utf8'));
  const installedPipeline = readManifest('planr-pipeline');
  console.log(`  · installed pipeline ${installedPipeline.version}`);
  // Deliberately NOT asserted here: "the resolved pipeline equals the declared
  // pin" is a tautology — npm installs exactly what the manifest declares, so it
  // can never fail and would be a green check that proves nothing. Whether the
  // declared pin is STALE relative to the released lattice is a real question,
  // and it is answered by tests/unit/pipeline-pin-parity.test.ts. What this gate
  // uniquely adds is what happens when the product is actually used.

  writeFileSync(join(project, 'package.json'), '{"name":"gate-project","version":"1.0.0"}\n');
  // Citations are anchored to a revision, so the fixture has to be a real
  // repository with a real commit — the same thing a user's project is.
  run('git', ['init', '-q'], { cwd: project });
  run('git', ['add', '-A'], { cwd: project });
  run(
    'git',
    ['-c', 'user.email=gate@example.invalid', '-c', 'user.name=Release Gate', 'commit', '-qm', 'fixture'],
    { cwd: project },
  );

  const inspect = JSON.parse(cliOutput(['operate', 'inspect', '--json']));
  check('operate inspect succeeds on a fresh project', inspect.ok === true);
  check(
    'inspect advertises the protocol the pipeline enforces, not a frozen envelope version',
    inspect.data?.pipeline?.protocolVersion === '1.4.0',
    `reported ${inspect.data?.pipeline?.protocolVersion}`,
  );

  // `setup` is the front door; it broke for every user once while CI stayed green.
  let setupExit = 0;
  try {
    cliOutput(['setup', '--yes', '--runtime', 'codex'], { stdio: 'pipe' });
  } catch (error) {
    setupExit = error.status ?? 1;
    notes.push(`setup stderr: ${String(error.stderr ?? '').slice(0, 400)}`);
  }
  check('planr setup completes on a clean machine', setupExit === 0);

  const skills = (() => {
    try {
      return readdirSync(join(home, '.codex', 'skills'));
    } catch {
      return [];
    }
  })();
  check('setup installed the runtime skills it reported', skills.length > 0, `found ${skills.length}`);

  // ── The cycle itself ────────────────────────────────────────────────────
  // Everything above is reachable by inspection. These steps require actually
  // driving the product, and they are where the expensive defects lived: a
  // mandate whose disclosed and enforced contracts diverged, a record path that
  // discarded a valid result, and status surfaces that reported a quiet board
  // while results sat on disk. Each was invisible to a green unit suite.
  /**
   * Run a `--json` command and return its payload.
   *
   * The CLI signals lifecycle states through exit codes — a healthy handoff is
   * not exit 0 — so a non-zero status is not by itself a failure. What matters
   * is the payload's `ok`. Capturing stdout on both paths also means a real
   * failure reports the CLI's own message instead of "Command failed", which is
   * what the first CI run of this gate produced and could not be acted on.
   */
  const jsonWithInput = (args, input) => {
    try {
      return JSON.parse(cliOutput(args, { input }));
    } catch (error) {
      const raw = String(error.stdout ?? '');
      if (raw.trim()) {
        try {
          return JSON.parse(raw);
        } catch {
          /* fall through */
        }
      }
      throw new Error(
        `${args.join(' ')} failed (exit ${error.status ?? '?'}): ${(raw || String(error.stderr ?? error.message)).slice(0, 300)}`,
      );
    }
  };

  const json = (args) => {
    let raw;
    try {
      raw = cliOutput(args);
    } catch (error) {
      raw = String(error.stdout ?? '');
      if (!raw.trim()) {
        throw new Error(
          `${args.join(' ')} produced no output (exit ${error.status}): ${String(error.stderr ?? '').slice(0, 300)}`,
        );
      }
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${args.join(' ')} did not emit JSON: ${raw.slice(0, 300)}`);
    }
  };
  const revision = run('git', ['rev-parse', 'HEAD'], { cwd: project }).trim();
  const citation = (extra = {}) => ({
    kind: 'repository',
    path: 'package.json',
    startLine: 1,
    endLine: 3,
    revision,
    ...extra,
  });

  json(['operate', '--json']);
  jsonWithInput(['operate', 'context', 'review', '--stdin', '--json'], JSON.stringify([
      {
        id: 'CTX-purpose',
        field: 'purpose',
        value: 'A release-gate fixture driven end to end against the packed artifact.',
        epistemicStatus: 'observed',
        confidence: 5,
        citations: [citation()],
      },
    ]));

  // A first-time author supplies the minimum. If the questionnaire rejects that,
  // the journey dead-ends before a cycle can start.
  const questionnaire = json(['operate', 'init', '--json']).questionnaire;
  const envelope = { ...questionnaire.submission.envelope.fixedFields };
  envelope.questionnaireDigest = questionnaire.digest;
  envelope.submittedAt = new Date().toISOString();
  // Answer each question by its OWN type and constraints. A fixture that sends
  // the same string to every question passes only while the questionnaire
  // happens to be all free text: a choice question then fails with "contains an
  // unsupported choice", which is what blocked the first release run using this
  // gate. Prefer the CLI's own suggestion — that is the value a real operator is
  // offered — and fall back to the declared vocabulary.
  const byId = new Map((questionnaire.questions ?? []).map((q) => [q.questionId, q]));
  const answerFor = (question) => {
    if (question?.suggestedValue !== undefined && question.suggestedValue !== null) {
      return question.suggestedValue;
    }
    const choices = question?.choices?.map((choice) => choice.id) ?? [];
    if (choices.length) return question.type === 'multi-choice' ? [choices[0]] : choices[0];
    if (question?.type === 'repeated-text') return ['Release gate fixture'];
    if (question?.type === 'boolean') return true;
    return 'Release Gate';
  };
  envelope.answers = questionnaire.submission.envelope.dynamicFields.answers.items.map((item) => ({
    questionId: item.questionId,
    questionVersion: item.questionVersion,
    sensitivity: item.sensitivity,
    value: answerFor(byId.get(item.questionId)),
  }));
  // A rejection here is a JOURNEY failure, not a broken gate: report it as a
  // failed assertion naming the reason, rather than letting a non-zero exit
  // surface as "the gate could not run".
  let preview = { ok: false, message: '' };
  try {
    preview = JSON.parse(
      cliOutput(['operate', 'init', '--resume', questionnaire.sessionId, '--stdin', '--json'], {
        input: JSON.stringify(envelope),
      }),
    );
  } catch (error) {
    const payload = String(error.stdout ?? '');
    try {
      preview = JSON.parse(payload);
    } catch {
      preview = { ok: false, message: payload.slice(0, 200) || String(error.message).slice(0, 200) };
    }
  }
  check(
    'a minimal first-run questionnaire reaches the write-free preview',
    preview.ok === true,
    preview.message ?? '',
  );
  if (preview.ok !== true) {
    // The rest of the journey depends on an initialized board; stopping here
    // keeps the report honest instead of cascading unrelated failures.
    console.log('  … remaining cycle checks skipped: initialization did not complete');
    throw new JourneyStop();
  }

  const confirmDigest = String(preview.next?.[0] ?? '').split('--confirm ')[1]?.split(' ')[0];
  json(['operate', 'init', '--resume', questionnaire.sessionId, '--confirm', confirmDigest, '--yes', '--json']);

  const started = json(['operate', 'run', '--json']);
  const prepareArgs = String(started.next?.[0] ?? '').replace(/^planr /, '').split(' ');
  const prepared = json([...prepareArgs]);
  const session = prepared.data ?? {};
  const mandate = session.mandates?.['strategy-finance'] ?? {};

  check(
    'the mandate discloses the contract it enforces',
    mandate.responseSchema === mandate.output?.schema,
    `enforced ${mandate.responseSchema}, disclosed ${mandate.output?.schema}`,
  );
  check(
    'the disclosed schema is dereferenceable and matches that version',
    String(mandate.output?.jsonSchema?.$id ?? '').includes(
      String(mandate.responseSchema ?? '').split('@')[1] ?? 'x',
    ),
    `$id ${mandate.output?.jsonSchema?.$id}`,
  );

  // A public workflow permission line is not a secret. Discarding a whole result
  // for quoting one cost a real cycle two round-trips and nearly a lens.
  const permissionLine = ['id', 'token'].join('-') + ': write';
  const response = {
    outcome: 'actions',
    analysisMarkdown: `The publish workflow requests ${permissionLine} so provenance can be attested.`,
    claims: [
      {
        id: 'c1',
        statement: `The workflow declares ${permissionLine}.`,
        epistemicStatus: 'observed',
        confidence: 5,
        citations: [citation()],
      },
    ],
    actions: [
      {
        actionKey: 'gate-probe',
        title: 'Release gate probe',
        summary: 'Recorded by the release-artifact gate.',
        lane: 'DEV',
        routeKind: 'quick-task',
        horizon: 'immediate',
        confidence: 5,
        citations: [citation()],
      },
    ],
    gaps: [],
    conflicts: [],
  };
  let recorded = false;
  try {
    cliOutput(
      [
        'operate', 'harness', 'record',
        '--role', 'strategy-finance',
        '--cycle-id', session.cycleId,
        '--evidence-digest', session.evidenceDigest,
        '--lease', session.lease,
        '--idempotency-key', session.idempotencyKey,
        '--stdin', '--json',
      ],
      { input: JSON.stringify(response) },
    );
    recorded = true;
  } catch (error) {
    notes.push(`record stderr: ${String(error.stdout ?? error.stderr ?? '').slice(0, 300)}`);
  }
  check('a result quoting a public permission line records', recorded);

  // With one lens recorded and the Chair outstanding, no surface may claim the
  // board is quiet or that the review gate has been reached.
  const statusText = cliOutput(['operate', 'status']);
  check(
    'status does not call a mid-flight cycle quiet',
    !/is quiet|Board is quiet/.test(statusText) || /not quiet/.test(statusText),
    statusText.split('\n')[0]?.slice(0, 120),
  );
  const reviewText = cliOutput(['operate', 'review']);
  check(
    'review does not claim a review gate the cycle has not reached',
    /has not reached the review gate/.test(reviewText),
    reviewText.split('\n')[0]?.slice(0, 120),
  );

  console.log('');
} catch (error) {
  // A JourneyStop means a check already recorded the failure and the remaining
  // steps depend on what failed — exit 1 (the artifact is broken), not 2 (the
  // gate is broken). Everything else is the gate itself failing to run.
  if (!(error instanceof JourneyStop)) {
    console.error(`\nRelease-artifact gate could not run: ${error.message}`);
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    process.exit(2);
  }
}

if (workspace) rmSync(workspace, { recursive: true, force: true });
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\n${failures.length} journey assertion(s) failed against the packed artifact.`);
  console.error('Do not publish: the tests may pass, but the thing being shipped does not work.');
  process.exit(1);
}
console.log('The packed artifact performs the primary journey correctly.');
