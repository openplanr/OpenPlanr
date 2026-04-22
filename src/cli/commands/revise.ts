/**
 * `planr revise` command.
 *
 * Runs the revise safety pipeline for a single artifact or a cascade:
 *
 *   1. **Clean-tree gate** — unless --allow-dirty.
 *   2. **Agent decision** — per artifact.
 *   3. **Evidence verification** — unverifiable evidence
 *      is dropped; revise → flag demotion when nothing survives.
 *   4. **Diff preview + confirmation** — per artifact.
 *   5. **Atomic write + audit log**.
 *
 * In `--cascade` mode, the cascade service drives the pipeline
 * top-down (epic → features → stories → tasks). Children always see the
 * *revised* parent because they are loaded fresh from disk between steps.
 * `[q]uit` and SIGINT stop the cascade gracefully — already-applied
 * artifacts stay applied, audit entries flush immediately.
 *
 *  layers on top of this command.
 */

import path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { AIUsage } from '../../ai/types.js';
import type {
  ArtifactType,
  CascadeLevel,
  ReviseAuditFormat,
  ReviseDecision,
} from '../../models/types.js';
import { getAIProvider, isAIConfigured } from '../../services/ai-service.js';
import {
  findArtifactTypeById,
  listArtifacts,
  readArtifactRaw,
} from '../../services/artifact-service.js';
import { type AuditLogWriter, createAuditLogWriter } from '../../services/audit-log-service.js';
import { buildCascadeOrder, executeCascade } from '../../services/cascade-service.js';
import { loadConfig } from '../../services/config-service.js';
import { renderDiff } from '../../services/diff-service.js';
import { verifyDecision } from '../../services/evidence-verifier.js';
import { checkCleanTree, checkoutPaths } from '../../services/git-service.js';
import { checkGraphIntegrity } from '../../services/graph-integrity.js';
import {
  confirmBulkRevise,
  promptReviseConfirm,
  promptText,
} from '../../services/prompt-service.js';
import {
  hashArtifactContent,
  loadCache,
  type ReviseCache,
  recordOutcome,
  saveCache,
  shouldSkipArtifact,
} from '../../services/revise-cache-service.js';
import {
  type ApplyDecisionResult,
  applyDecision,
  ReviseArtifactNotFoundError,
  reviseArtifact,
} from '../../services/revise-service.js';
import { display, logger } from '../../utils/logger.js';

type ReviseWritableScope = 'prose' | 'references' | 'paths' | 'all';

const WRITABLE_SCOPES: ReviseWritableScope[] = ['prose', 'references', 'paths', 'all'];
const AUDIT_FORMATS: ReviseAuditFormat[] = ['md', 'json'];

interface ReviseCommandOptions {
  dryRun: boolean;
  yes: boolean;
  allowDirty: boolean;
  cascade: boolean;
  all: boolean;
  maxWritesPerRun: number;
  scopeTo: string;
  codeContext: boolean;
  siblingContext: boolean;
  audit?: string;
  auditFormat: string;
  /** replay a previously-written audit report with zero model calls. */
  applyFrom?: string;
}

const DEFAULT_MAX_WRITES_PER_RUN = 50;

export function registerReviseCommand(program: Command) {
  program
    .command('revise')
    .description('AI-driven revision of planning artifacts against codebase reality')
    .argument(
      '[artifactId]',
      'artifact ID (e.g., EPIC-001, , US-003, TASK-004). Omit and pass --all to revise every epic in the project.',
    )
    .option(
      '--dry-run',
      'do not write files; still emit an audit log with would-apply entries',
      false,
    )
    .option('--yes', 'skip per-artifact confirmation menu (still requires typed-YES in TTY)', false)
    .option(
      '--allow-dirty',
      'run even with uncommitted changes (post-flight rollback cannot restore them)',
      false,
    )
    .option(
      '--cascade',
      'revise this artifact and its descendants top-down (epic → features → stories → tasks)',
      false,
    )
    .option('--no-cascade', 'explicitly disable cascade (overrides --cascade)')
    .option(
      '--all',
      'revise every epic in the project top-down; mutually exclusive with artifactId',
      false,
    )
    .option(
      '--max-writes-per-run <n>',
      `hard cap on writes performed in one run; exceeding this aborts with partial audit log (default: ${DEFAULT_MAX_WRITES_PER_RUN})`,
      (v) => parseInt(v, 10),
      DEFAULT_MAX_WRITES_PER_RUN,
    )
    .option(
      '--scope-to <scope>',
      `which parts of the artifact the agent may modify: ${WRITABLE_SCOPES.join(', ')}`,
      'all',
    )
    .option('--no-code-context', 'skip codebase context assembly (fast mode)')
    .option('--no-sibling-context', 'skip immediate-sibling context gathering')
    .option('--audit <path>', 'override the default audit log path')
    .option('--audit-format <format>', `audit log format: ${AUDIT_FORMATS.join(', ')}`, 'md')
    .option(
      '--apply-from <report-path>',
      'replay an existing dry-run audit report to disk without any model calls. Ignores --dry-run, --cascade, --all, and AI flags; other safety gates (clean-tree, atomic write, graph integrity) still run.',
    )
    .action(async (artifactId: string | undefined, opts: ReviseCommandOptions) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // apply-from-audit short-circuits the whole AI pipeline.
      // Runs before all AI-path validation because this mode makes no model calls.
      if (opts.applyFrom) {
        const { runApplyFromAudit } = await import('../../services/revise-apply-service.js');
        const exitCode = await runApplyFromAudit({
          projectDir,
          config,
          auditPath: opts.applyFrom,
          allowDirty: opts.allowDirty,
          dryRun: opts.dryRun,
          yes: opts.yes,
        });
        process.exit(exitCode);
      }

      // Mutually-exclusive: --all vs explicit artifact id.
      if (opts.all && artifactId) {
        logger.error('Cannot combine --all with an explicit artifact id. Pass one or the other.');
        process.exit(1);
      }
      if (!opts.all && !artifactId) {
        logger.error(
          'Missing required artifact id. Pass an id (e.g. EPIC-001) or use --all to revise every epic.',
        );
        process.exit(1);
      }

      if (!isAIConfigured(config)) {
        logger.error('AI not configured. Run `planr config set-provider` to enable AI.');
        logger.dim(
          'Unlike refine, revise has no deterministic-only fallback — it must call an AI provider.',
        );
        process.exit(1);
      }

      if (!WRITABLE_SCOPES.includes(opts.scopeTo as ReviseWritableScope)) {
        logger.error(
          `Invalid --scope-to: "${opts.scopeTo}". Expected one of: ${WRITABLE_SCOPES.join(', ')}`,
        );
        process.exit(1);
      }
      if (!AUDIT_FORMATS.includes(opts.auditFormat as ReviseAuditFormat)) {
        logger.error(
          `Invalid --audit-format: "${opts.auditFormat}". Expected one of: ${AUDIT_FORMATS.join(', ')}`,
        );
        process.exit(1);
      }
      if (!Number.isFinite(opts.maxWritesPerRun) || opts.maxWritesPerRun < 1) {
        logger.error(`Invalid --max-writes-per-run: must be a positive integer.`);
        process.exit(1);
      }

      const rootType = artifactId ? findArtifactTypeById(artifactId) : undefined;
      if (artifactId && !rootType) {
        logger.error(`Cannot determine artifact type from ID: ${artifactId}`);
        logger.dim('Expected format: EPIC-001, , US-001, TASK-001');
        process.exit(1);
      }

      const writableScope = opts.scopeTo as ReviseWritableScope;
      const auditFormat = opts.auditFormat as ReviseAuditFormat;

      // --- Layer 1: clean-tree gate --------------------------------------
      const treeCheck = await checkCleanTree(projectDir, { allowDirty: opts.allowDirty });
      if (!treeCheck.ok) {
        logger.error(treeCheck.message);
        process.exit(1);
      }
      if (treeCheck.status.kind !== 'clean') {
        logger.warn(treeCheck.message);
      }

      // --- Bulk confirmation: typed-YES in TTY, flag-only in CI ----------
      if (opts.yes && !opts.dryRun) {
        const summary = await buildBulkConfirmationSummary(artifactId, opts, projectDir, config);
        const confirmed = await confirmBulkRevise(summary);
        if (!confirmed) {
          logger.dim('Confirmation declined — exiting without changes.');
          process.exit(0);
        }
      }

      const scope = opts.all ? 'all' : (artifactId as string);
      const writer = createAuditLogWriter({
        projectDir,
        scope,
        cascade: opts.cascade || opts.all,
        dryRun: opts.dryRun,
        format: auditFormat,
        overridePath: opts.audit,
      });
      logger.dim(`Audit log: ${writer.path}`);

      // SIGINT guard: if the user Ctrl+Cs during a diff preview prompt (or at
      // any other point before the run completes), close the audit log with
      // an `interrupted: sigint` footer so the on-disk record is consistent.
      // Installed once; removed in the finally block below.
      let sigintFired = false;
      const onSigint = () => {
        if (sigintFired) return; // defend against repeated signals
        sigintFired = true;
        try {
          writer.close({ interrupted: { reason: 'sigint', atArtifactId: scope } });
        } catch {
          // best-effort — process is exiting regardless
        }
        logger.warn('\nSIGINT received — audit log closed. Exiting.');
        // 128 + signal number (SIGINT = 2) is the shell convention for signal exits.
        process.exit(130);
      };
      process.once('SIGINT', onSigint);

      logger.heading(
        `Revise ${scope}${opts.cascade || opts.all ? ' (cascade)' : ''} (${opts.dryRun ? 'dry-run' : 'apply'})`,
      );

      const preFlightHeadPaths = await collectCandidateArtifactPaths(projectDir, config);

      try {
        const provider = await getAIProvider(config);

        if (opts.all) {
          await runAll(projectDir, config, provider, opts, writableScope, writer);
        } else if (opts.cascade) {
          await runCascade(
            projectDir,
            config,
            provider,
            rootType as ArtifactType,
            artifactId as string,
            opts,
            writableScope,
            writer,
          );
        } else {
          await runSingle(
            projectDir,
            config,
            provider,
            artifactId as string,
            opts,
            writableScope,
            writer,
          );
        }

        // --- Post-flight graph integrity + rollback
        if (!opts.dryRun) {
          const report = await checkGraphIntegrity(projectDir, config);
          if (!report.ok) {
            logger.error(
              `Post-flight graph integrity broken: ${report.issues.length} broken parent/child link(s).`,
            );
            for (const issue of report.issues) {
              logger.dim(
                `  · ${issue.childType} ${issue.childId} → ${issue.parentField}=${issue.parentId} (${issue.reason})`,
              );
            }
            if (opts.allowDirty) {
              logger.warn(
                'Rollback disabled (--allow-dirty was passed; pre-run state may not match git HEAD).',
              );
            } else {
              logger.warn('Triggering post-flight rollback via `git checkout`…');
              await checkoutPaths(projectDir, preFlightHeadPaths);
              logger.info(`Rolled back ${preFlightHeadPaths.length} artifact path(s) to HEAD.`);
            }
            process.exitCode = 1;
          } else {
            logger.dim('Post-flight graph integrity: ok.');
          }
        }
      } catch (err) {
        writer.close();
        if (err instanceof ReviseArtifactNotFoundError) {
          logger.error(err.message);
          logger.dim('Expected format: EPIC-001, , US-001, TASK-001');
          process.exit(1);
        }
        const { AIError } = await import('../../ai/errors.js');
        if (err instanceof AIError) {
          logger.error(err.userMessage);
          process.exit(1);
        }
        throw err;
      } finally {
        // Always detach the SIGINT listener — normal completion shouldn't
        // leave a process-level handler bound to this run's writer.
        process.removeListener('SIGINT', onSigint);
      }
    });
}

// ---------------------------------------------------------------------------
// Single-artifact path
// ---------------------------------------------------------------------------

async function runSingle(
  projectDir: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: Awaited<ReturnType<typeof getAIProvider>>,
  artifactId: string,
  opts: ReviseCommandOptions,
  writableScope: ReviseWritableScope,
  writer: AuditLogWriter,
): Promise<void> {
  const backupDir = defaultBackupDir(projectDir, artifactId);
  const result = await processOneArtifact(
    projectDir,
    config,
    provider,
    artifactId,
    opts,
    writableScope,
    writer,
    backupDir,
    undefined, // no cascade level tag
  );

  writer.close({
    tokenUsage: result.usage,
    interrupted: result.quit ? { reason: 'q', atArtifactId: artifactId } : undefined,
  });

  renderFinalOutcome(result, artifactId);
}

// ---------------------------------------------------------------------------
// --- All-epics path
// ---------------------------------------------------------------------------

async function runAll(
  projectDir: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: Awaited<ReturnType<typeof getAIProvider>>,
  opts: ReviseCommandOptions,
  writableScope: ReviseWritableScope,
  writer: AuditLogWriter,
): Promise<void> {
  const epics = await listArtifacts(projectDir, config, 'epic');
  if (epics.length === 0) {
    logger.warn('No epics found in the project — nothing to revise.');
    writer.close();
    return;
  }
  logger.dim(`--all scope: ${epics.length} epic(s) found.`);

  let totalWrites = 0;
  let cacheSkips = 0;
  const aggregateUsage: AIUsage = { inputTokens: 0, outputTokens: 0 };
  let cache: ReviseCache = loadCache(projectDir);

  for (const epic of epics) {
    if (totalWrites >= opts.maxWritesPerRun) {
      logger.warn(
        `Hit --max-writes-per-run=${opts.maxWritesPerRun}; stopping --all run early to cap blast radius.`,
      );
      break;
    }
    logger.info(`\n→ Cascading ${epic.id}`);
    const plan = await buildCascadeOrder(projectDir, config, 'epic', epic.id);
    const backupDir = defaultBackupDir(projectDir, epic.id);

    const cascadeResult = await executeCascade({
      plan,
      onProgress: (p) => {
        logger.dim(
          `  [${p.completed + 1}/${p.total}] ${p.currentLevelLabel}: ${p.currentArtifactId}${
            p.etaSeconds != null ? ` · ~${p.etaSeconds}s left` : ''
          }`,
        );
      },
      processor: async ({ artifactId, levelLabel }) => {
        if (totalWrites >= opts.maxWritesPerRun) return { continue: false, stopReason: 'q' };

        // Cache lookup: if this artifact's raw content is unchanged since a
        // prior 'skipped-by-agent' run, skip the AI call entirely.
        const artifactType = findArtifactTypeById(artifactId);
        if (artifactType) {
          const raw = await readArtifactRaw(projectDir, config, artifactType, artifactId);
          if (raw) {
            const artifactHash = hashArtifactContent(raw);
            if (shouldSkipArtifact(cache, artifactId, artifactHash, undefined)) {
              cacheSkips++;
              logger.dim(`  [cache] ${artifactId} unchanged since last clean revise — skip.`);
              return { continue: true };
            }

            const out = await processOneArtifact(
              projectDir,
              config,
              provider,
              artifactId,
              opts,
              writableScope,
              writer,
              backupDir,
              levelLabel,
            );
            aggregateUsage.inputTokens += out.usage.inputTokens;
            aggregateUsage.outputTokens += out.usage.outputTokens;
            if (out.wrote) totalWrites++;

            // Record outcome (cache is updated in-memory; flushed at end of --all).
            if (
              out.outcome === 'skipped-by-agent' ||
              out.outcome === 'applied' ||
              out.outcome === 'would-apply' ||
              out.outcome === 'flagged'
            ) {
              cache = recordOutcome(cache, artifactId, artifactHash, undefined, out.outcome);
            }

            if (out.quit) return { continue: false, stopReason: 'q' };
            return { continue: true };
          }
        }
        // Fallback: artifact unresolvable — process without cache touching.
        const out = await processOneArtifact(
          projectDir,
          config,
          provider,
          artifactId,
          opts,
          writableScope,
          writer,
          backupDir,
          levelLabel,
        );
        aggregateUsage.inputTokens += out.usage.inputTokens;
        aggregateUsage.outputTokens += out.usage.outputTokens;
        if (out.wrote) totalWrites++;
        if (out.quit) return { continue: false, stopReason: 'q' };
        return { continue: true };
      },
    });

    if (cascadeResult.interrupted) {
      writer.close({
        tokenUsage: aggregateUsage,
        interrupted: {
          reason: cascadeResult.interrupted.reason,
          atArtifactId: cascadeResult.interrupted.atArtifactId,
        },
      });
      logger.warn(`Stopped inside ${epic.id} (reason: ${cascadeResult.interrupted.reason}).`);
      return;
    }
  }

  writer.close({ tokenUsage: aggregateUsage });
  await saveCache(projectDir, cache);

  logger.info(
    `\n--all complete: ${totalWrites} write(s) across ${epics.length} epic(s). Cache hits: ${cacheSkips}.`,
  );
  logger.dim(
    `Tokens: ${aggregateUsage.inputTokens.toLocaleString()} in → ${aggregateUsage.outputTokens.toLocaleString()} out`,
  );
}

// ---------------------------------------------------------------------------
// Cascade path
// ---------------------------------------------------------------------------

async function runCascade(
  projectDir: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: Awaited<ReturnType<typeof getAIProvider>>,
  rootType: ArtifactType,
  rootId: string,
  opts: ReviseCommandOptions,
  writableScope: ReviseWritableScope,
  writer: AuditLogWriter,
): Promise<void> {
  const plan = await buildCascadeOrder(projectDir, config, rootType, rootId);
  logger.dim(
    `Cascade plan: ${plan.levels
      .filter((l) => l.artifactIds.length > 0)
      .map((l) => `${l.label}=${l.artifactIds.length}`)
      .join(', ')} · total=${plan.orderedIds.length}`,
  );

  const backupDir = defaultBackupDir(projectDir, rootId);
  const aggregateUsage: AIUsage = { inputTokens: 0, outputTokens: 0 };

  const result = await executeCascade({
    plan,
    onProgress: (p) => {
      logger.dim(
        `[${p.completed + 1}/${p.total}] ${p.currentLevelLabel}: ${p.currentArtifactId}${
          p.etaSeconds != null ? ` · ~${p.etaSeconds}s left` : ''
        }`,
      );
    },
    processor: async ({ artifactId, levelLabel }) => {
      const out = await processOneArtifact(
        projectDir,
        config,
        provider,
        artifactId,
        opts,
        writableScope,
        writer,
        backupDir,
        levelLabel,
      );
      aggregateUsage.inputTokens += out.usage.inputTokens;
      aggregateUsage.outputTokens += out.usage.outputTokens;
      if (out.quit) return { continue: false, stopReason: 'q' };
      return { continue: true };
    },
  });

  writer.close({
    tokenUsage: aggregateUsage,
    interrupted: result.interrupted
      ? { reason: result.interrupted.reason, atArtifactId: result.interrupted.atArtifactId }
      : undefined,
  });

  logger.info(
    `\nCascade complete: ${result.completed}/${result.total} artifacts processed${
      result.interrupted ? ` (interrupted: ${result.interrupted.reason})` : ''
    }`,
  );
  logger.dim(
    `Tokens: ${aggregateUsage.inputTokens.toLocaleString()} in → ${aggregateUsage.outputTokens.toLocaleString()} out`,
  );
  if (result.interrupted?.reason === 'agent_error') {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Shared per-artifact pipeline
// ---------------------------------------------------------------------------

interface ProcessOneResult {
  outcome: ApplyDecisionResult['outcome'];
  wrote: boolean;
  quit: boolean;
  usage: AIUsage;
  artifactPath: string;
}

async function processOneArtifact(
  projectDir: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
  provider: Awaited<ReturnType<typeof getAIProvider>>,
  artifactId: string,
  opts: ReviseCommandOptions,
  writableScope: ReviseWritableScope,
  writer: AuditLogWriter,
  backupDir: string,
  cascadeLevel: CascadeLevel['label'] | undefined,
): Promise<ProcessOneResult> {
  const result = await reviseArtifact(projectDir, config, provider, artifactId, {
    dryRun: true,
    writableScope,
    noCodeContext: !opts.codeContext,
    noSiblingContext: !opts.siblingContext,
  });

  const verified = await verifyDecision(result.decision, result.verifierContext);
  if (verified.dropped.length > 0) {
    logger.warn(
      `${artifactId}: dropped ${verified.dropped.length} unverifiable evidence citation(s) — see audit log.`,
    );
  }
  if (verified.demoted) {
    logger.warn(`${artifactId}: decision demoted "revise" → "flag" (unverifiable evidence).`);
  }

  renderDecision(verified.decision, result.originalContent);

  const finalDecision = await confirmAndMaybeEditRationale(
    verified.decision,
    result.originalContent,
    opts,
  );

  const applyResult = await applyDecision({
    artifactPath: result.artifactPath,
    originalContent: result.originalContent,
    decision: finalDecision,
    backupDir,
    audit: writer,
    dryRun: opts.dryRun || finalDecision.__userSkipped === true,
    cascadeLevel,
  });

  return {
    outcome: applyResult.outcome,
    wrote: applyResult.wrote,
    quit: finalDecision.__userQuit === true,
    usage: result.usage,
    artifactPath: result.artifactPath,
  };
}

// ---------------------------------------------------------------------------
// Confirmation + rendering helpers
// ---------------------------------------------------------------------------

interface DecisionWithUserState extends ReviseDecision {
  __userSkipped?: boolean;
  __userQuit?: boolean;
}

async function confirmAndMaybeEditRationale(
  decision: ReviseDecision,
  originalContent: string,
  opts: { yes: boolean; dryRun: boolean },
): Promise<DecisionWithUserState> {
  if (decision.action !== 'revise') return decision;
  if (opts.dryRun) return decision;
  if (opts.yes) return decision;

  let current: DecisionWithUserState = { ...decision };
  for (;;) {
    const action = await promptReviseConfirm(current.artifactId);
    switch (action) {
      case 'apply':
        return current;
      case 'skip':
        return { ...current, __userSkipped: true };
      case 'quit':
        return { ...current, __userSkipped: true, __userQuit: true };
      case 'diff-again':
        renderDecision(current, originalContent);
        continue;
      case 'edit-rationale': {
        const edited = await promptText(
          'New rationale (recorded in the audit log):',
          current.rationale,
        );
        current = { ...current, rationale: edited };
        continue;
      }
    }
  }
}

function renderDecision(decision: ReviseDecision, originalContent: string): void {
  display.separator(60);

  const actionColor =
    decision.action === 'revise'
      ? chalk.yellow
      : decision.action === 'flag'
        ? chalk.magenta
        : chalk.green;
  display.heading(`  Action: ${actionColor(decision.action.toUpperCase())}`);
  display.line(`  Artifact: ${decision.artifactId}`);
  display.line(`  Rationale: ${decision.rationale}`);

  if (decision.evidence.length > 0) {
    display.line('');
    display.heading('  Evidence:');
    for (const ev of decision.evidence) {
      const quote = ev.quote
        ? ` — "${ev.quote.slice(0, 80)}${ev.quote.length > 80 ? '…' : ''}"`
        : '';
      display.line(`    • [${ev.type}] ${ev.ref}${quote}`);
    }
  }

  if (decision.ambiguous.length > 0) {
    display.line('');
    display.heading('  Ambiguous (human decision required):');
    for (const amb of decision.ambiguous) {
      display.line(`    • §${amb.section}: ${amb.reason}`);
    }
  }

  if (decision.action === 'revise' && decision.revisedMarkdown) {
    display.line('');
    display.heading('  Proposed diff:');
    const diff = renderDiff(originalContent, decision.revisedMarkdown, {
      oldLabel: `${decision.artifactId} (before)`,
      newLabel: `${decision.artifactId} (proposed)`,
    });
    display.line(
      diff
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );
  }

  display.separator(60);
}

function renderFinalOutcome(result: ProcessOneResult, artifactId: string): void {
  const badge =
    result.outcome === 'applied'
      ? chalk.green('applied')
      : result.outcome === 'would-apply'
        ? chalk.yellow('would-apply')
        : result.outcome === 'flagged'
          ? chalk.magenta('flagged')
          : chalk.dim(result.outcome);
  logger.info(`\nOutcome: ${badge}`);
  if (result.wrote) {
    logger.dim(
      `\nWrote ${result.artifactPath}\nSuggested commit: git commit -am "chore(plan): revise ${artifactId} against codebase"`,
    );
  }
  if (result.usage.inputTokens > 0) {
    logger.dim(
      `Tokens: ${result.usage.inputTokens.toLocaleString()} in → ${result.usage.outputTokens.toLocaleString()} out`,
    );
  }
}

function defaultBackupDir(projectDir: string, scope: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return path.join(projectDir, '.planr', 'reports', `revise-${scope}-${stamp}`, 'backup');
}

/**
 * Build the blast-radius summary for the typed-YES prompt. For `--all`,
 * lists every epic (not just a count) so the user sees exact scope. For
 * single scope, a shorter summary suffices.
 */
async function buildBulkConfirmationSummary(
  artifactId: string | undefined,
  opts: ReviseCommandOptions,
  projectDir: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<string> {
  if (opts.all) {
    const epics = await listArtifacts(projectDir, config, 'epic');
    const list = epics.map((e) => `  - ${e.id}`).join('\n');
    return `About to revise EVERY epic and its descendants in ${projectDir}. Affected epics (${epics.length}):\n${list}\n\nWrites are atomic with sidecar backups; max writes per run: ${opts.maxWritesPerRun}.`;
  }
  if (opts.cascade) {
    return `About to revise ${artifactId} AND its descendants (top-down cascade) in ${projectDir}. Writes are atomic with sidecar backups.`;
  }
  return `About to revise ${artifactId} in ${projectDir}. Writes are atomic with sidecar backups.`;
}

/**
 * Collect every artifact-file path under the four managed directories so
 * the post-flight rollback has a bounded set to restore with `git checkout`.
 * Intentionally wider than "paths we will write" — if revise touched a file
 * unexpectedly, rollback still catches it.
 */
async function collectCandidateArtifactPaths(
  projectDir: string,
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<string[]> {
  const types: ArtifactType[] = ['epic', 'feature', 'story', 'task'];
  const rel: string[] = [];
  for (const t of types) {
    const listing = await listArtifacts(projectDir, config, t);
    for (const entry of listing) {
      rel.push(`${config.outputPaths.agile}/${pluralDir(t)}/${entry.filename}`);
    }
  }
  return rel;
}

function pluralDir(t: ArtifactType): string {
  if (t === 'story') return 'stories';
  if (t === 'epic') return 'epics';
  if (t === 'feature') return 'features';
  if (t === 'task') return 'tasks';
  return `${t}s`;
}
