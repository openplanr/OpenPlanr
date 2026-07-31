import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  executeOperateAction,
  type OperateActionRequest,
  type OperateActionResult,
} from '../../src/services/operate/index.js';
import {
  operatingRegistryDispatchMode,
  operatingRuntimeEnforcesBoundedReadOnly,
  resolveOperatingDispatchMode,
} from '../../src/services/operate/mission-dispatch.js';
import type { OperatingRoleId } from '../../src/services/operate/types.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function gitProject(): Promise<string> {
  const projectRoot = await temporaryDirectory('openplanr-operate-skill-first-project-');
  await execFileAsync('git', ['init', '--quiet'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.name', 'OpenPlanr Test'], { cwd: projectRoot });
  await execFileAsync('git', ['config', 'user.email', 'test@openplanr.invalid'], {
    cwd: projectRoot,
  });
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await writeFile(
    join(projectRoot, 'src', 'service.ts'),
    'export function health(): string {\n  return "ok";\n}\n',
  );
  await execFileAsync('git', ['add', '-A'], { cwd: projectRoot });
  await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: projectRoot });
  return projectRoot;
}

// The exact non-secret answer set a fully-specified `planr operate init --json`
// would carry. In the guided flow the skill collects these through the
// question-registry/answer-service; supplying them as options here is the
// scriptable equivalent that reaches `preview-ready` in one JSON call.
const INIT_OPTIONS = {
  json: true,
  profile: 'saas',
  decisionOwner: 'Asem',
  planningEngine: 'openplanr',
  runtime: 'claude',
  cadence: 'manual',
  timezone: 'UTC',
  sensitivityCeiling: 'internal',
  sources: ['repository', 'git'],
  charter: {
    purpose: 'Guide an evidence-backed product.',
    stage: 'growth',
    businessModel: 'subscription',
    idealCustomer: 'technical product teams',
    goals: ['Produce reviewable decisions.'],
    successMetrics: ['Time to a cited brief'],
    guardrails: ['Humans approve mutations'],
    knownUnknowns: ['Current activation baseline'],
  },
} as const;

// A schema-valid, quiet native advisor response. This is the RUNTIME's output
// (what a bounded native lens returns on stdin), never an adapter lifecycle
// command — the command that carries it is always taken from a prior handoff.
const QUIET_NATIVE_RESPONSE = JSON.stringify({
  outcome: 'quiet',
  proposals: [],
  gaps: [],
  conflicts: [],
});

/**
 * The skill-path executor: turn one emitted `planr operate …` argv (from a
 * prior step's `handoff.next[].argv`) back into an `OperateActionRequest` and
 * run it through the same JSON facade. The skill does exactly this — it never
 * invents a command; it replays the argv the CLI handed it. The argv fed here
 * therefore proves the call originated from the skill surface, not a human.
 */
function requestFromEmittedArgv(
  argv: readonly string[],
  projectRoot: string,
): OperateActionRequest {
  expect(argv.slice(0, 2)).toEqual(['planr', 'operate']);
  const group = argv[2];
  const bare = ['inspect', 'run', 'review', 'brief', 'status', 'demo', 'report', 'init'].includes(
    group,
  );
  const action = bare ? group : `${group}.${argv[3]}`;
  const flagTokens = bare ? argv.slice(3) : argv.slice(4);
  const options: Record<string, unknown> = { json: true };
  for (let index = 0; index < flagTokens.length; index += 1) {
    const token = flagTokens[index];
    if (!token.startsWith('--')) continue;
    const key = token
      .slice(2)
      .replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());
    const next = flagTokens[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  const request: OperateActionRequest = { action, projectRoot, interactive: false, options };
  if (action === 'adapter.record') request.stdin = QUIET_NATIVE_RESPONSE;
  return request;
}

// The one-line, versioned envelope invariant every JSON action must satisfy, so
// the skill can parse each step identically. `JSON.stringify` is single-line by
// construction; asserting the absence of a newline anchors the "one line,
// stderr diagnostics only" contract at the value the CLI prints.
function assertEnvelopeParity(result: OperateActionResult): void {
  expect(result.schemaVersion).toBe('1.0.0');
  expect(typeof result.protocolVersion).toBe('string');
  expect(typeof result.ok).toBe('boolean');
  expect(typeof result.action).toBe('string');
  expect(result).toHaveProperty('paths');
  expect(result).toHaveProperty('counts');
  expect(Array.isArray(result.warnings)).toBe(true);
  expect(Array.isArray(result.nextActions)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('\n');
}

// The skill drives the next step from BOTH surfaces the regenerated templates
// read: the machine handoff (`handoff.next[].argv`) and the structured action
// list (`actions[].command`, owned by action-service.ts). For a mission
// lifecycle/continue step these MUST be byte-identical, or the two skill code
// paths would disagree about what to run next.
function assertHandoffActionParity(result: OperateActionResult): void {
  const handoffCommands = (result.handoff?.next ?? []).map((entry) => entry.argv.join(' '));
  expect(handoffCommands).toEqual(result.nextActions);
  expect((result.actions ?? []).map((action) => action.command)).toEqual(result.nextActions);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('operate skill-first, zero-adapter-command cycle (FR9 / E-009)', () => {
  it('drives a bare project to a reviewable brief with every adapter lifecycle call issued from the skill/JSON surface', async () => {
    const projectRoot = await gitProject();

    // Every `planr operate …` command the skill path emitted so far. Nothing may
    // reach an adapter lifecycle call unless it first appears here — i.e. unless a
    // prior JSON step handed it to the skill. This is the ledger that turns
    // "zero user-typed adapter commands" into an assertion rather than a claim.
    const emittedCommands = new Set<string>();
    const remember = (result: OperateActionResult): void => {
      for (const value of result.nextActions) emittedCommands.add(value);
      for (const action of result.actions ?? []) emittedCommands.add(action.command);
      for (const entry of result.handoff?.next ?? []) emittedCommands.add(entry.argv.join(' '));
    };
    // The ordered spine of actions the scripted run actually executed.
    const transcript: string[] = [];
    const run = async (request: OperateActionRequest): Promise<OperateActionResult> => {
      const result = await executeOperateAction(request);
      assertEnvelopeParity(result);
      transcript.push(request.action);
      remember(result);
      return result;
    };

    // 1. inspect — a bare, uninitialized project points only at init.
    const inspected = await run({
      action: 'inspect',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    expect(inspected).toMatchObject({ ok: true, action: 'inspect' });
    expect((inspected.data as { initialized?: boolean }).initialized).toBe(false);
    expect(inspected.nextActions).toEqual(['planr operate init']);

    // 2. init preview — the JSON facade returns the digest-bound apply action the
    // skill confirms; nothing is written yet.
    const previewed = await run({
      action: 'init',
      projectRoot,
      interactive: false,
      options: { ...INIT_OPTIONS, preview: true },
    });
    expect(previewed).toMatchObject({ ok: true, state: 'preview-ready' });
    const applyAction = previewed.actions?.find((entry) => entry.id === 'operate.init.apply');
    const answersToken = applyAction?.command.match(/--answers-token ([A-Za-z0-9_-]+)/)?.[1];
    const previewCreatedAt = (previewed.preview as { previewCreatedAt?: string } | undefined)
      ?.previewCreatedAt;
    expect(answersToken).toBeTruthy();
    expect(previewCreatedAt).toBeTruthy();
    expect(applyAction?.confirmationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    // 3. init apply — confirmed with the exact preview digest the skill received.
    const initialized = await run({
      action: 'init',
      projectRoot,
      interactive: false,
      options: {
        ...INIT_OPTIONS,
        answersToken,
        previewCreatedAt,
        confirm: applyAction?.confirmationDigest,
        yes: true,
      },
    });
    expect(
      initialized.ok,
      JSON.stringify({
        step: 'init.apply',
        action: initialized.action,
        code: initialized.code,
        message: initialized.message,
        data: initialized.data,
      }),
    ).toBe(true);
    expect(initialized.nextActions).toContain('planr operate run');

    // 4. run — a native (claude) runtime defers advisors and hands back an adapter
    // start handoff instead of running providers inline. The presence of that
    // handoff after `run` is the structural proof that a native lens dispatch was
    // selected (a fallback runtime would have completed inline with no handoff).
    let result = await run({
      action: 'run',
      projectRoot,
      interactive: false,
      options: { json: true, runtime: 'claude', depth: 'standard' },
    });
    expect(result).toMatchObject({ ok: true, state: 'advising' });
    expect(result.handoff?.state).toBe('prepare-required');
    assertHandoffActionParity(result);

    // 5. Walk the lifecycle purely from emitted handoffs: prepare → record(s) →
    // finalize → run.continue, once for the advisor phase and once for the chair
    // phase, until the cycle reaches `reviewable`. The loop NEVER authors an
    // `adapter …` command; it only replays `handoff.next[0].argv`.
    const adapterActions: string[] = [];
    const handoffStates: string[] = [];
    const runStates: string[] = [];
    let guard = 0;
    while (result.handoff && (result.handoff.next?.length ?? 0) > 0) {
      expect(guard++).toBeLessThan(40);
      handoffStates.push(result.handoff.state);
      // A driving lifecycle state serializes to exactly one next step.
      expect(result.handoff.next).toHaveLength(1);
      const next = result.handoff.next[0];
      const command = next.argv.join(' ');

      if (next.action.startsWith('adapter.')) {
        // The command MUST have been emitted by a prior skill-path step. It is
        // never constructed in this test — it is looked up, then replayed.
        expect(emittedCommands.has(command)).toBe(true);
        adapterActions.push(next.action);
      } else {
        expect(next.action).toBe('run.continue');
        expect(emittedCommands.has(command)).toBe(true);
      }

      result = await run(requestFromEmittedArgv(next.argv, projectRoot));
      // Carry the failing step's context and the result's error payload so a
      // platform-specific failure (this has surfaced only on ubuntu/Node-20)
      // names the real error in CI instead of a bare `expected false to be
      // true`. The result shape has no `.error`; the diagnostic fields are
      // `code`/`message`/`data` (see failure() in services/operate/index.ts).
      expect(
        result.ok,
        JSON.stringify({
          step: next.action,
          argv: next.argv,
          handoffState: handoffStates.at(-1),
          action: result.action,
          state: result.state,
          code: result.code,
          message: result.message,
          data: result.data,
        }),
      ).toBe(true);
      if (result.action === 'run') runStates.push(String(result.state));
      // Parity is re-checked at every lifecycle/continue step end to end.
      if (result.handoff && (result.handoff.next?.length ?? 0) > 0) {
        assertHandoffActionParity(result);
      }
    }

    // The two native phases each ran prepare → (record…) → finalize, and each
    // finalize handed back exactly one `run.continue` the skill replayed.
    expect(adapterActions.filter((entry) => entry === 'adapter.prepare')).toHaveLength(2);
    expect(adapterActions.filter((entry) => entry === 'adapter.finalize')).toHaveLength(2);
    expect(
      adapterActions.filter((entry) => entry === 'adapter.record').length,
    ).toBeGreaterThanOrEqual(1);
    expect(handoffStates).toContain('record-required');
    expect(handoffStates).toContain('finalize-required');
    expect(handoffStates).toContain('continue-required');
    expect(runStates.filter((state) => state === 'advising')).toHaveLength(1);
    expect(runStates.at(-1)).toBe('reviewable');

    // Zero user-typed adapter commands: EVERY adapter lifecycle action executed
    // was replayed from the emitted-command ledger, never authored here.
    const executedAdapterCommands = transcript.filter((action) => action.startsWith('adapter.'));
    expect(executedAdapterCommands.length).toBeGreaterThanOrEqual(4);

    // 6. review — the mandatory human gate; no route was applied by the run.
    const reviewed = await run({
      action: 'review',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    expect(reviewed).toMatchObject({ ok: true, action: 'review' });

    // 7. brief — the reviewable brief renders from the same committed state.
    const brief = await run({
      action: 'brief',
      projectRoot,
      interactive: false,
      options: { json: true },
    });
    expect(brief).toMatchObject({ ok: true, action: 'brief' });
    expect(brief.data).toBeDefined();

    // The full spine reached review/brief through the JSON facade alone: inspect
    // and init opened it, run and the emitted lifecycle carried it to reviewable,
    // and review/brief closed it — with the adapter subsequence entirely
    // handoff-derived.
    expect(transcript[0]).toBe('inspect');
    expect(transcript).toContain('run');
    expect(transcript.slice(-2)).toEqual(['review', 'brief']);
  });

  it('selects the T-003 fallback path from capabilities: claude dispatches natively, codex and cursor fall closed to the structured provider', async () => {
    // The runtime enforceability bit is read from the published adapter
    // capabilities (toolIsolation === 'enforced'), the single source of truth the
    // pipeline's own handoff uses. Only claude-code enforces; codex and cursor are
    // advisory, so FR2's fail-closed rule overrides FR4 for them.
    expect(await operatingRuntimeEnforcesBoundedReadOnly('claude')).toBe(true);
    expect(await operatingRuntimeEnforcesBoundedReadOnly('codex')).toBe(false);
    expect(await operatingRuntimeEnforcesBoundedReadOnly('cursor')).toBe(false);

    const registryDefault = operatingRegistryDispatchMode({});
    expect(registryDefault).toBe('mission');

    const roleId = 'strategy-finance' as OperatingRoleId;

    // A runtime that natively enforces isolation, hosting a native-capable
    // adapter, receives a bounded read-only mission lens.
    const claude = resolveOperatingDispatchMode({
      roleId,
      registryDefault,
      runtimeEnforcesBoundedReadOnly: true,
      adapterNativeCapable: true,
    });
    expect(claude).toMatchObject({
      mode: 'mission',
      isolation: 'enforced-read-only-bounded',
      native: true,
    });

    // Codex/Cursor: mission is requested, but advisory isolation cannot guarantee
    // the boundary, so the role falls closed to the structured provider path —
    // NOT a native lens — consistent with T-003's reconciliation.
    for (const runtimeEnforcesBoundedReadOnly of [false]) {
      const fallback = resolveOperatingDispatchMode({
        roleId,
        registryDefault,
        runtimeEnforcesBoundedReadOnly,
        adapterNativeCapable: true,
      });
      expect(fallback).toMatchObject({
        mode: 'mission',
        isolation: 'fail-closed-structured-provider',
        native: false,
      });
      expect(fallback.reconciliation).toMatch(/fail-closed|advisory|unverifiable/i);
    }
  });
});
