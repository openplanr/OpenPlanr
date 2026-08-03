import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { materializeLargeMonorepo } from './materialize-monorepo.mjs';

/**
 * Real-runtime Operate canary driver (FR15).
 *
 * Drives a REAL `runOperatingCycle` — the real fan-out lifecycle driver, real
 * lease/heartbeat, real filesystem projection, real Chair consolidation, and
 * real persisted report — inside a large monorepo whose `.planr/` is gitignored,
 * with one lens intentionally stalled. Only the advisor CONTENT is scripted; the
 * orchestration is the release artifact. This is the exact shape of the
 * OpenPlanr `operate-lifecycle-chair-wiring` integration suite, pointed at the
 * marketplace large-monorepo + stalled-role fixtures and captured as canary
 * evidence.
 *
 * Real native-agent dispatch (a live Claude Code / Codex / Cursor subagent) is
 * NOT exercised here — that is the owner-gated matrix. Scripting the advisor
 * content is what lets this reproduce the shipped deadlock unattended: the defect
 * was an orchestration hang on a stalled lens, never an advisor's output.
 */

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) options[arg.slice(2)] = argv[i + 1];
  }
  return options;
}

const assertions = [];
function check(description, condition, detail) {
  assertions.push({ description, ok: Boolean(condition), detail: detail ?? null });
  if (!condition) {
    throw new Error(`FAIL: ${description}${detail ? ` — ${detail}` : ''}`);
  }
  process.stdout.write(`  ok  ${description}\n`);
}

function equalSet(a, b) {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function importOperate(openplanrRoot, moduleName) {
  const target = join(openplanrRoot, 'dist', 'services', 'operate', `${moduleName}.js`);
  return import(pathToFileURL(target).href);
}

function scriptedAdapter(advisorScript) {
  const byRole = new Map(advisorScript.roles.map((role) => [role.roleId, role]));
  const invocations = new Map();
  const adapter = {
    id: 'real-runtime-canary-fixture',
    mode: 'structured',
    toolIsolation: 'not-applicable',
    capability: 'analysis-high',
    parallelDispatch: true,
    async invoke(input) {
      invocations.set(input.roleId, (invocations.get(input.roleId) ?? 0) + 1);
      const role = byRole.get(input.roleId);
      if (!role || role.behavior === 'stall') {
        // The hung lens: never returns. The driver's per-attempt timeout and
        // bounded retry budget must resolve it to not_evaluated.
        return new Promise(() => {});
      }
      const citations = [
        {
          repositoryPath: advisorScript.citationPath,
          lineRange: { start: 1, end: 1 },
          pinnedRevision: input.pinnedRevision,
        },
      ];
      return {
        outcome: 'proposals',
        proposals: [
          {
            proposalKey: `${input.roleId}-proposal`,
            type: role.type ?? 'finding',
            title: role.title,
            problem: role.problem,
            proposal: role.proposal,
            impact: 3,
            confidence: 3,
            ease: 4,
            severity: role.severity ?? 'medium',
            citations,
          },
        ],
        gaps: [],
        conflicts: [],
      };
    },
  };
  return { adapter, invocations };
}

// FR6 internal-transport tokens that must never appear in the human transcript.
const TRANSPORT_LEAKS = [
  /operate\s+(harness|adapter)\s+(record|prepare|finalize|resume|cancel|heartbeat)/i,
  /idempotenc/i,
  /lease[_-]?token/i,
  /"lease"\s*:/i,
  /--answers-token/i,
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const openplanrRoot = resolve(
    options.openplanr ?? process.env.OPENPLANR_CLI_ROOT ?? join(here, '..', '..', '..', 'OpenPlanr'),
  );
  const pipelineRoot = resolve(
    options.pipeline ??
      process.env.OPENPLANR_PIPELINE_ROOT ??
      join(here, '..', '..', '..', 'planr-pipeline'),
  );
  const evidenceDir = resolve(options.evidence ?? join(here, '..', '..', 'evidence'));
  const runUrl = options['run-url'] ?? process.env.RUN_URL ?? 'local';
  process.env.OPENPLANR_PIPELINE_ROOT = pipelineRoot;

  const advisorScript = JSON.parse(
    readFileSync(join(here, 'stalled-role', 'advisor-script.json'), 'utf8'),
  );
  const stalledRole = advisorScript.stalledRole;
  const stickyRuntime = advisorScript.runtime;
  const lenses = advisorScript.roles
    .filter((role) => role.roleId !== 'chair')
    .map((role) => role.roleId);
  const healthyLenses = lenses.filter((roleId) => roleId !== stalledRole);

  process.stdout.write(`Real-runtime Operate canary (stall=${stalledRole}, runtime=${stickyRuntime})\n`);

  const { prepareOperatingInitialization, applyOperatingInitialization } = await importOperate(
    openplanrRoot,
    'config',
  );
  const { runOperatingCycle } = await importOperate(openplanrRoot, 'engine');
  const { OperatingEventStore } = await importOperate(openplanrRoot, 'event-store');
  const { readOperatingReport } = await importOperate(openplanrRoot, 'reports');

  const projectRoot = mkdtempSync(join(tmpdir(), 'openplanr-canary-monorepo-'));
  const localRoot = mkdtempSync(join(tmpdir(), 'openplanr-canary-local-'));
  const cleanup = () => {
    for (const dir of [projectRoot, localRoot]) {
      try {
        rmSync(dir, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        /* best-effort */
      }
    }
  };

  try {
    // Scenario 4 — large monorepo with a gitignored .planr.
    const { fileCount } = materializeLargeMonorepo({ directory: projectRoot });
    check('large monorepo materialized with a real worktree', fileCount > 100, `${fileCount} files`);
    let ignored = false;
    try {
      execFileSync('git', ['check-ignore', '--quiet', '.planr'], { cwd: projectRoot });
      ignored = true;
    } catch {
      ignored = false;
    }
    check('git check-ignore .planr succeeds (planning tree is gitignored)', ignored);
    const staged = execFileSync('git', ['ls-files', '.planr'], { cwd: projectRoot, encoding: 'utf8' });
    check('.planr is never staged for commit', staged.trim().length === 0, staged.trim());

    const preview = await prepareOperatingInitialization({
      projectRoot,
      localRoot,
      profile: 'custom',
      decisionOwner: 'Product owner',
      planningEngine: 'openplanr',
      runtime: stickyRuntime,
      timezone: 'UTC',
      sensitivityCeiling: 'internal',
      customProfile: {
        enabledRoles: [...lenses, 'chair'],
        caps: { surfacedFindings: 20, newSpecs: 6, openDecisions: 6, agentArtifacts: 4 },
      },
      charter: {
        purpose: 'Exercise the durable Operate fan-out over a large monorepo.',
        goals: ['Keep the cycle honest and durable when a lens stalls.'],
      },
      now: '2026-07-28T12:00:00.000Z',
    });
    await applyOperatingInitialization({
      projectRoot,
      localRoot,
      preview,
      confirmationDigest: preview.previewDigest,
    });

    const { adapter, invocations } = scriptedAdapter(advisorScript);
    // Real timers. A generous per-attempt timeout lets the healthy lenses record
    // comfortably even on slow (Windows) CI I/O over a large monorepo, while the
    // stalled lens NEVER resolves and therefore always loses to the timeout and
    // exhausts its bounded retry budget. The lease window stays far shorter than
    // the heartbeat lead so the heartbeat provably fires while the lens hangs.
    const lifecycleHooks = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle),
      roleTimeoutMs: 8_000,
      retryBudget: 2,
      heartbeatIntervalMs: 150,
      heartbeatLeadMs: 1_000,
      leaseWindowMs: 400,
    };

    const result = await runOperatingCycle({
      projectRoot,
      localRoot,
      adapter,
      confirmed: true,
      now: new Date('2026-07-28T13:00:00.000Z'),
      advisorLifecycle: lifecycleHooks,
    });

    // Scenario 2 — the stalled role.
    const lifecycle = result.advisorLifecycle;
    check('the cycle drove the inline advisor lifecycle driver', Boolean(lifecycle));
    check(
      'the stalled lens terminates not_evaluated (not blocking the fan-out)',
      equalSet(lifecycle.notEvaluated, [stalledRole]),
      JSON.stringify(lifecycle.notEvaluated),
    );
    check(
      "the other four lenses' results are durably recorded",
      equalSet(lifecycle.recorded, healthyLenses),
      JSON.stringify(lifecycle.recorded),
    );
    const stalledGap = (lifecycle.gaps ?? []).find((gap) => gap.roleId === stalledRole);
    check(
      'the stalled lens carries a governed not_evaluated gap with a reason',
      stalledGap?.outcome === 'not_evaluated' && (stalledGap.reason ?? '').length > 0,
      JSON.stringify(stalledGap ?? null),
    );
    check(
      'the lease is renewed by the heartbeat while the lens hangs',
      (lifecycle.heartbeats ?? 0) >= 1,
      `heartbeats=${lifecycle.heartbeats}`,
    );

    // Scenario 1 — complete cycle to the review gate; Chair present.
    const recordedRoleIds = (result.roleResults ?? []).map((role) => role.roleId);
    check('the cycle reaches Chair over the partial board', recordedRoleIds.includes('chair'));
    check(
      'the stalled lens contributed no recorded result',
      !recordedRoleIds.includes(stalledRole),
    );
    for (const roleId of healthyLenses) {
      check(`recorded lens ${roleId} is present in the board`, recordedRoleIds.includes(roleId));
    }

    // Durability invariant: no lens is RECORDED more than once. (Within-cycle
    // bounded retry of a not-yet-recorded lens is legitimate driver behavior;
    // the no-re-dispatch-of-recorded-work guarantee across a terminate-and-resume
    // is proven by the OpenPlanr resume suites the workflow runs alongside this.)
    check(
      'no lens is recorded more than once',
      lifecycle.recorded.length === new Set(lifecycle.recorded).size,
      JSON.stringify(lifecycle.recorded),
    );
    for (const roleId of healthyLenses) {
      check(
        `recorded lens ${roleId} was dispatched at least once`,
        (invocations.get(roleId) ?? 0) >= 1,
        `invocations=${invocations.get(roleId)}`,
      );
    }

    // Durable on disk: the recorded work survives independently of the run object.
    const state = await new OperatingEventStore(projectRoot, { localRoot }).state();
    check(
      'the stalled lens is a durable governed gap on disk',
      state.dataGaps.some(
        (gap) => Array.isArray(gap.affectedRoles) && gap.affectedRoles.includes(stalledRole),
      ),
    );

    // Report is printed AND persisted (FR5/FR14).
    const report = await readOperatingReport({ projectRoot, localRoot, cycleId: result.cycle.id });
    const byRole = new Map(report.reports.map((entry) => [entry.roleId, entry]));
    for (const roleId of healthyLenses) {
      check(
        `persisted report renders ${roleId} with a real analysis`,
        byRole.get(roleId)?.outcome !== 'not_evaluated',
        byRole.get(roleId)?.outcome,
      );
    }
    check(
      'persisted report renders the stalled lens as not_evaluated (honest state)',
      byRole.get(stalledRole)?.outcome === 'not_evaluated',
      byRole.get(stalledRole)?.outcome,
    );
    check('a report is persisted and printable', report.markdown.length > 0);
    process.stdout.write('\n----- persisted operating report (printed) -----\n');
    process.stdout.write(`${report.markdown}\n`);
    process.stdout.write('----- end persisted operating report -----\n\n');

    // Scenario 5 — transport hiding: the human transcript carries no internal transport.
    const leaks = TRANSPORT_LEAKS.filter((pattern) => pattern.test(report.markdown)).map(String);
    check(
      'no internal transport (lease/idempotency/harness command) leaks into the human report',
      leaks.length === 0,
      leaks.join(', '),
    );

    // Scenario 6 — no cross-runtime process or asset.
    const cycleProducer = (result.cycle && result.cycle.producer) || {};
    check(
      `the cycle is sticky to a single runtime (${stickyRuntime})`,
      cycleProducer.runtime === stickyRuntime,
      cycleProducer.runtime,
    );
    const otherRuntimes = ['claude-code', 'codex', 'cursor'].filter((r) => r !== stickyRuntime);
    const crossRuntime = otherRuntimes.filter((r) => report.markdown.includes(r));
    check(
      'the run produced no asset bound to another runtime',
      crossRuntime.length === 0,
      crossRuntime.join(', '),
    );

    const evidence = {
      schemaVersion: '1.0.0',
      kind: 'openplanr-operating-real-runtime-canary-evidence',
      runUrl,
      stalledRole,
      stickyRuntime,
      recorded: [...lifecycle.recorded].sort(),
      notEvaluated: [...lifecycle.notEvaluated].sort(),
      heartbeats: lifecycle.heartbeats,
      chairReached: recordedRoleIds.includes('chair'),
      reportPersisted: report.markdown.length > 0,
      transportLeaks: leaks,
      crossRuntimeAssets: crossRuntime,
      monorepoFileCount: fileCount,
      assertions,
    };
    writeFileSync(join(evidenceDir, 'real-runtime-canary.log'), `${JSON.stringify(evidence)}\n`);
    process.stdout.write(
      `\nReal-runtime Operate canary passed ${assertions.length} assertions; ` +
        `evidence: ${join(evidenceDir, 'real-runtime-canary.log')}\n`,
    );
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
