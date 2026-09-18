/**
 * `planr spec` command group — spec-driven planning mode.
 *
 * The third planning posture alongside agile (epic/feature/story/task) and
 * QT (quick task). The host-native `planr-plan` skill decomposes specs into
 * nested User Stories and Tasks with the same artifact contract
 * (file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD
 * with build/test commands). Pairs with the pipeline plugin via shared
 * schema — no conversion layer ever.
 *
 * Subcommands:
 *   - planr spec init                    Activate spec-driven mode
 *   - planr spec create <title>          Create a new SPEC artifact (self-contained dir)
 *   - planr spec shape <id>              Professional interactive or JSON authoring
 *   - planr spec sync [id]               Validate integrity + auto-fix safe issues
 *   - planr spec list                    List all specs
 *   - planr spec show <id>               Print a spec + its US/Task tree
 *   - planr spec status [id]             Decomposition state per spec
 *   - planr spec destroy <id>            rm -rf one self-contained spec dir
 *   - planr spec attach-design <id> --files <png>...   Attach UI mockups
 *   - planr spec promote <id>            Validate + print pipeline handoff
 */

import { readFile as readBinaryFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import { isNonInteractive, requireInteractiveForManual } from '../../services/interactive-state.js';
import { promptConfirm, promptMultiText, promptText } from '../../services/prompt-service.js';
import {
  attachSpecDesigns,
  createSpec,
  destroySpec,
  getSpecStatus,
  listSpecStories,
  listSpecs,
  listSpecTasks,
  PROFESSIONAL_SPECIFICATION_CONTRACT,
  PROFESSIONAL_SPECIFICATION_KIND,
  PROFESSIONAL_SPECIFICATION_MAX_INPUT_BYTES,
  PROFESSIONAL_SPECIFICATION_PROTOCOL_VERSION,
  PROFESSIONAL_SPECIFICATION_SCHEMA_VERSION,
  parseProfessionalSpecAnswers,
  readSpec,
  resolveSpecDir,
  type ShapeSpecAnswers,
  shapeSpec,
  syncAllSpecs,
  syncSpec,
  updateSpecFields,
  validateSpecForPromotion,
} from '../../services/spec-service.js';
import { display, logger } from '../../utils/logger.js';
import { CliBoundaryError } from '../error-boundary.js';

function professionalSpecInputError(
  code: string,
  problem: string,
  recovery: string,
  cause?: unknown,
): CliBoundaryError {
  return new CliBoundaryError(code, problem, { cause, recovery });
}

function decodeProfessionalSpecInput(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw professionalSpecInputError(
      'E_PROFESSIONAL_SPEC_INPUT_INVALID',
      'Professional specification input must be valid UTF-8 JSON.',
      'Provide one UTF-8 JSON object no larger than 128KB.',
      error,
    );
  }
}

/** Read one bounded professional specification JSON object from a regular file or stdin. */
export async function readBoundedProfessionalSpecInput(
  source: string,
  stdin: AsyncIterable<string | Uint8Array> = process.stdin,
): Promise<ShapeSpecAnswers> {
  let bytes: Uint8Array;
  if (source === '-') {
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for await (const chunk of stdin) {
        const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > PROFESSIONAL_SPECIFICATION_MAX_INPUT_BYTES) {
          throw professionalSpecInputError(
            'E_PROFESSIONAL_SPEC_INPUT_TOO_LARGE',
            'Professional specification input exceeds the 128KB limit.',
            'Provide a smaller closed professional specification object.',
          );
        }
        chunks.push(buffer);
      }
      bytes = Buffer.concat(chunks, total);
    } catch (error) {
      if (error instanceof CliBoundaryError) throw error;
      throw professionalSpecInputError(
        'E_PROFESSIONAL_SPEC_STDIN_UNREADABLE',
        'Professional specification input could not be read from standard input.',
        'Retry with --file <path> or provide valid JSON on stdin.',
        error,
      );
    }
  } else {
    try {
      const resolved = path.resolve(source);
      const metadata = await stat(resolved);
      if (!metadata.isFile()) throw new Error('not a regular file');
      if (metadata.size > PROFESSIONAL_SPECIFICATION_MAX_INPUT_BYTES) {
        throw professionalSpecInputError(
          'E_PROFESSIONAL_SPEC_INPUT_TOO_LARGE',
          'Professional specification input exceeds the 128KB limit.',
          'Provide a smaller closed professional specification object.',
        );
      }
      bytes = await readBinaryFile(resolved);
    } catch (error) {
      if (error instanceof CliBoundaryError) throw error;
      throw professionalSpecInputError(
        'E_PROFESSIONAL_SPEC_FILE_UNREADABLE',
        'The professional specification input file could not be read.',
        'Provide a readable regular UTF-8 JSON file no larger than 128KB.',
        error,
      );
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeProfessionalSpecInput(bytes));
  } catch (error) {
    if (error instanceof CliBoundaryError) throw error;
    throw professionalSpecInputError(
      'E_PROFESSIONAL_SPEC_JSON_INVALID',
      'Professional specification input is not valid JSON.',
      'Provide one closed professional-specification@1.0.0 JSON object.',
      error,
    );
  }
  return parseProfessionalSpecAnswers(parsed);
}

async function promptProfessionalSpecAnswers(): Promise<ShapeSpecAnswers> {
  logger.dim(
    'Professional authoring captures decision, evidence, failure, and recovery boundaries.',
  );
  logger.dim('Press Ctrl+C at any time to abort without saving.');
  logger.dim('');

  const context = await promptText('Problem and context (one decision-complete sentence)');
  const primary = await promptText('Primary user or decision audience');
  const affected = await promptMultiText(
    'Other materially affected audiences (comma-separated)',
    'e.g., support operators, security reviewers',
  );

  logger.dim('');
  logger.dim('Outcome & Measurement');
  const statement = await promptText('Outcome statement');
  const measure = await promptText('Observable measure');
  const target = await promptText('Pass target or threshold');
  const timeframe = await promptText('Measurement timeframe');

  const functionalRequirements = await promptMultiText(
    'Functional requirements (comma-separated)',
    'one observable behavior per item',
  );
  const constraints = await promptMultiText(
    'Constraints (comma-separated)',
    'technical, legal, operational, time, or budget boundaries',
  );
  const evidenceExpectations = await promptMultiText(
    'Evidence expectations (comma-separated)',
    'exact proof required for acceptance',
  );
  const failureModes = await promptMultiText(
    'Failure modes (comma-separated)',
    'credible failure plus observable detection',
  );
  const rollback = await promptText('Rollback or compensating action and its trigger');
  const inScope = await promptMultiText('In-scope boundaries (comma-separated)');
  const outOfScope = await promptMultiText('Out-of-scope boundaries (comma-separated)');
  const acceptanceCriteria = await promptMultiText(
    'Decision-complete acceptance criteria (comma-separated)',
    'Given/When/Then format recommended',
  );
  const declaredSpecialists = await promptMultiText(
    'Declared risk specialists (optional, comma-separated)',
    'security, performance, migration, api-contract, data-integrity',
  );
  const businessRules = await promptMultiText('Additional business rules (optional)');
  const decompositionNotes = await promptText('Decomposition notes (optional)');

  return parseProfessionalSpecAnswers({
    kind: PROFESSIONAL_SPECIFICATION_KIND,
    schemaVersion: PROFESSIONAL_SPECIFICATION_SCHEMA_VERSION,
    protocolVersion: PROFESSIONAL_SPECIFICATION_PROTOCOL_VERSION,
    context,
    audience: { primary, affected },
    outcome: { statement, measure, target, timeframe },
    functionalRequirements,
    constraints,
    evidenceExpectations,
    failureModes,
    rollback,
    scope: { inScope, outOfScope },
    acceptanceCriteria,
    declaredSpecialists,
    businessRules,
    decompositionNotes,
  });
}

export function registerSpecCommand(program: Command) {
  const spec = program
    .command('spec')
    .description(
      'Spec-driven storage and validation for artifacts authored by the active host agent.',
    );

  // ------------------------------------------------------------------------
  // planr spec init
  // ------------------------------------------------------------------------
  spec
    .command('init')
    .description('Activate spec-driven mode in this project (creates .planr/specs/ root)')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // Ensure spec prefix exists in config (older projects predate this field).
      let configChanged = false;
      if (!config.idPrefix.spec) {
        config.idPrefix.spec = 'SPEC';
        configChanged = true;
      }
      if (configChanged) {
        await saveConfig(projectDir, config);
      }

      // Create .planr/specs/ root.
      const { ensureDir, fileExists, writeFile } = await import('../../utils/fs.js');
      const specsRoot = path.join(projectDir, config.outputPaths.agile, 'specs');
      const existed = await fileExists(specsRoot);
      await ensureDir(specsRoot);
      if (!existed) {
        await writeFile(path.join(specsRoot, '.gitkeep'), '');
      }

      logger.success('Spec-driven mode activated.');
      logger.dim(`  ${specsRoot}`);
      if (configChanged) {
        logger.dim('  Added "spec: SPEC" to config.json idPrefix.');
      } else if (existed) {
        logger.dim('  (Already initialized — no changes.)');
      }
      logger.dim('');
      display.line('Next steps:');
      display.line('  1. Author a spec:    planr spec create --title "<feature title>"');
      display.line('  2. Optional: attach: planr spec attach-design <SPEC-id> --files <png>...');
      display.line('  3. Plan:             invoke planr-plan in the active host agent');
      display.line('  4. Review:           planr spec show <SPEC-id>');
      display.line('  5. Promote:          planr spec promote <SPEC-id>');
      display.line('  6. Start delivery:  invoke $planr:ship with the selected T-NNN task');
    });

  // ------------------------------------------------------------------------
  // planr spec create
  // ------------------------------------------------------------------------
  spec
    .command('create')
    .description('Create a new spec — a self-contained directory with stories/, tasks/, design/')
    .option('--title <title>', 'spec title (required if not given as positional argument)')
    .option('--slug <slug>', 'explicit kebab-case slug; otherwise derived from title')
    .option('--priority <priority>', 'P0 / P1 / P2 (default: P1)', 'P1')
    .option('--milestone <milestone>', 'milestone label (e.g., v1.0)')
    .option('--po <handle>', 'Product Owner handle (e.g., @AsemDevs)')
    .argument('[title...]', 'spec title (alternative to --title)')
    .action(async (titleParts: string[], opts) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const title = (opts.title as string | undefined) || titleParts.join(' ').trim();
      if (!title) {
        logger.error('Provide a title: planr spec create "Auth flow"  OR  --title "Auth flow"');
        process.exit(1);
      }

      try {
        const { id, specDir, specFile } = await createSpec(projectDir, config, title, {
          slug: opts.slug,
          priority: opts.priority,
          milestone: opts.milestone,
          po: opts.po,
        });

        logger.success(`Created ${id}: ${title}`);
        logger.dim(`  Directory: ${specDir}`);
        logger.dim(`  Spec file: ${specFile}`);
        logger.dim('');
        display.line('Next steps:');
        display.line(`  - Edit the spec body:           ${specFile}`);
        display.line(`  - Or use guided authoring:      planr spec shape ${id}`);
        display.line(
          `  - Attach UI mockups (optional): planr spec attach-design ${id} --files <png>...`,
        );
        display.line(`  - Create stories and tasks:    invoke planr-plan for ${id}`);
        display.line(`  - Review the tree:              planr spec show ${id}`);
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });

  // ------------------------------------------------------------------------
  // planr spec shape <id>
  // ------------------------------------------------------------------------
  spec
    .command('shape')
    .description('Author a decision-complete professional specification')
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .option('--file <path|->', 'read one bounded professional specification JSON object')
    .option('--json', 'emit one machine-readable result', false)
    .action(async (specId: string, opts: { file?: string; json?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const artifact = await readSpec(projectDir, config, specId);
      if (!artifact) {
        throw new CliBoundaryError(
          'E_PROFESSIONAL_SPEC_NOT_FOUND',
          'The requested spec was not found.',
          {
            recovery: 'Run `planr spec list` and retry with one existing spec ID.',
          },
        );
      }

      let answers: ShapeSpecAnswers;
      if (opts.file) {
        answers = await readBoundedProfessionalSpecInput(opts.file);
      } else {
        if (isNonInteractive()) {
          throw new CliBoundaryError(
            'E_PROFESSIONAL_SPEC_INPUT_REQUIRED',
            'Professional specification shaping requires --file in non-interactive mode.',
            {
              recovery: 'Provide --file <path|-> with one bounded JSON object.',
              missing: ['file'],
            },
          );
        }
        requireInteractiveForManual(true);
        logger.heading(`Shape ${artifact.id}: ${artifact.data.title || artifact.slug}`);
        answers = await promptProfessionalSpecAnswers();
      }

      const { specFile } = await shapeSpec(projectDir, config, specId, answers);
      const artifactPath = path.relative(projectDir, specFile).split(path.sep).join('/');
      if (opts.json) {
        display.line(
          JSON.stringify({
            ok: true,
            action: 'spec.professional-shaped',
            specId: artifact.id,
            contract: PROFESSIONAL_SPECIFICATION_CONTRACT,
            status: 'shaped',
            next: `$planr:plan ${artifact.id}`,
            artifactPath,
          }),
        );
        return;
      }

      logger.success(`Shaped ${artifact.id}.`);
      logger.dim(`  ${specFile}`);
      logger.dim(`  Contract: ${PROFESSIONAL_SPECIFICATION_CONTRACT}`);
      logger.dim('  Status: shaped');
      logger.dim('');
      display.line(`Next step: invoke planr-plan in your active coding agent for ${artifact.id}.`);
    });

  // ------------------------------------------------------------------------
  // planr spec list
  // ------------------------------------------------------------------------
  spec
    .command('list')
    .description('List all specs in the project')
    .action(async () => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const specs = await listSpecs(projectDir, config);

      if (specs.length === 0) {
        logger.info('No specs found. Run `planr spec create "<title>"` to create one.');
        return;
      }

      logger.heading('Specs');
      for (const s of specs) {
        const counts = `${s.storyCount} US, ${s.taskCount} tasks`;
        display.line(`  ${s.id}  [${s.status.padEnd(18)}]  ${s.title}  (${counts})`);
      }
    });

  // ------------------------------------------------------------------------
  // planr spec show <id>
  // ------------------------------------------------------------------------
  spec
    .command('show')
    .description('Print a spec + its decomposition tree (stories, tasks)')
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .action(async (specId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);
      const spec = await readSpec(projectDir, config, specId);
      if (!spec) {
        logger.error(`Spec ${specId} not found.`);
        process.exit(1);
      }

      logger.heading(`${spec.id}: ${spec.data.title || spec.slug}`);
      display.line(`  Status:    ${spec.data.status || 'pending'}`);
      display.line(`  Priority:  ${spec.data.priority || '(unset)'}`);
      display.line(`  Milestone: ${spec.data.milestone || '(unset)'}`);
      display.line(`  PO:        ${spec.data.po || '(unset)'}`);
      display.line(`  Created:   ${spec.data.created || '(unset)'}`);
      display.line(`  Updated:   ${spec.data.updated || '(unset)'}`);
      display.line(`  Spec file: ${spec.specFile}`);
      display.line('');

      const stories = await listSpecStories(spec.specDir);
      const tasks = await listSpecTasks(spec.specDir);

      if (stories.length === 0) {
        display.line('  Stories:   (none — invoke planr-plan to author them)');
      } else {
        display.line(`  Stories (${stories.length}):`);
        for (const s of stories) {
          const taskCount = tasks.filter((t) => t.storyId === s.id).length;
          display.line(`    ${s.id}  [${s.status.padEnd(13)}]  ${s.title}  (${taskCount} tasks)`);
        }
      }
      display.line('');

      if (tasks.length === 0) {
        display.line('  Tasks:     (none)');
      } else {
        display.line(`  Tasks (${tasks.length}):`);
        for (const t of tasks) {
          display.line(
            `    ${t.id}  [${t.status.padEnd(13)}]  ${t.type.padEnd(4)} ${t.agent.padEnd(20)} ${t.title}`,
          );
        }
      }
      display.line('');
      display.line('  Planning workflow:');
      display.line(`    Codex/ChatGPT: $planr:plan ${spec.id}`);
      display.line(`    Claude Code:   /planr:plan ${spec.id}`);
    });

  // ------------------------------------------------------------------------
  // planr spec status [id]
  // ------------------------------------------------------------------------
  spec
    .command('status')
    .description('Decomposition state across all specs (or one spec if --spec specified)')
    .argument('[specId]', 'optional spec ID to scope output')
    .action(async (specId?: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      if (specId) {
        const spec = await readSpec(projectDir, config, specId);
        if (!spec) {
          logger.error(`Spec ${specId} not found.`);
          process.exit(1);
        }
        const stories = await listSpecStories(spec.specDir);
        const tasks = await listSpecTasks(spec.specDir);
        logger.heading(`${spec.id}: ${spec.data.title || spec.slug}`);
        display.line(`  Status:  ${spec.data.status || 'pending'}`);
        display.line(`  Stories: ${stories.length}`);
        display.line(`  Tasks:   ${tasks.length}`);
        return;
      }

      const report = await getSpecStatus(projectDir, config);
      if (report.specCount === 0) {
        logger.info('No specs found. Run `planr spec init` then `planr spec create "<title>"`.');
        return;
      }
      logger.heading('Spec-driven mode status');
      display.line(`  Total specs:   ${report.specCount}`);
      display.line(`  Total stories: ${report.totalStories}`);
      display.line(`  Total tasks:   ${report.totalTasks}`);
      display.line('');
      for (const s of report.specs) {
        display.line(
          `  ${s.id}  [${s.status.padEnd(18)}]  ${s.title}  (${s.storyCount} US, ${s.taskCount} tasks)`,
        );
      }
    });

  // ------------------------------------------------------------------------
  // planr spec destroy <id>
  // ------------------------------------------------------------------------
  spec
    .command('destroy')
    .description('Remove a spec entirely (rm -rf of its self-contained directory)')
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .action(async (specId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const resolved = await resolveSpecDir(projectDir, config, specId);
      if (!resolved) {
        logger.error(`Spec ${specId} not found.`);
        process.exit(1);
      }

      const ok = await promptConfirm(
        `Delete ${specId} and ALL its stories, tasks, and design assets?`,
        false,
      );
      if (!ok) {
        logger.info('Cancelled.');
        return;
      }

      await destroySpec(projectDir, config, specId);
      logger.success(`Destroyed ${specId}.`);
      logger.dim(`  Removed: ${resolved.dir}`);
    });

  // ------------------------------------------------------------------------
  // planr spec attach-design <id> --files ...
  // ------------------------------------------------------------------------
  spec
    .command('attach-design')
    .description("Copy PNG mockups into a spec's design/ directory and update ui_files frontmatter")
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .option('--files <paths...>', 'one or more PNG files to attach')
    .action(async (specId: string, opts: { files?: string[] }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const files = opts.files;
      if (!files || files.length === 0) {
        logger.error('Provide --files <path>... with one or more PNG paths.');
        process.exit(1);
      }

      try {
        const { copied, designDir } = await attachSpecDesigns(projectDir, config, specId, files);
        if (copied.length === 0) {
          logger.warn('No PNG files were copied. Check the paths exist and end in .png.');
          return;
        }
        logger.success(`Attached ${copied.length} design asset(s) to ${specId}.`);
        for (const f of copied) {
          logger.dim(`  design/${f}`);
        }
        logger.dim('');
        logger.dim(`Design directory: ${designDir}`);
        logger.dim(
          `The host-native planr-plan skill can analyze these PNGs into design/design-spec.md.`,
        );
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });

  // ------------------------------------------------------------------------
  // planr spec promote <id>
  // ------------------------------------------------------------------------
  spec
    .command('promote')
    .description('Validate that a spec is ready and print the pipeline handoff command')
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .action(async (specId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      const validation = await validateSpecForPromotion(projectDir, config, specId);
      if (!validation.ready) {
        logger.error(`Spec ${specId} is not ready for the pipeline:`);
        for (const issue of validation.issues) {
          logger.error(`  • ${issue}`);
        }
        process.exit(1);
      }

      const spec = await readSpec(projectDir, config, specId);
      if (!spec) return; // unreachable if validation passed

      await updateSpecFields(projectDir, config, specId, { status: 'ready-for-pipeline' });

      logger.success(`${specId} is ready for host-native implementation.`);
      logger.dim('');
      display.line('Next: invoke the host-native Plan skill:');
      display.line(`  $planr:plan ${spec.id}`);
      display.line('');
      display.line('After reviewing the plan, invoke $planr:ship with its exact T-NNN selector.');
    });

  // ------------------------------------------------------------------------
  // planr spec sync [specId]
  // ------------------------------------------------------------------------
  spec
    .command('sync')
    .description(
      'Validate spec integrity (orphaned tasks, stories without tasks, missing specId frontmatter, schema drift)',
    )
    .argument('[specId]', 'optional spec ID to scope; otherwise scans all specs')
    .option('--dry-run', 'report findings without writing any fixes', false)
    .action(async (specId: string | undefined, opts: { dryRun?: boolean }) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      try {
        if (specId) {
          const report = await syncSpec(projectDir, config, specId, { dryRun: opts.dryRun });
          logger.heading(`${report.specId}: ${report.specSlug}`);
          if (report.fixed.length === 0 && report.warnings.length === 0) {
            logger.success('Clean. No issues found.');
            return;
          }
          if (report.fixed.length > 0) {
            logger.success(
              `${opts.dryRun ? 'Would fix' : 'Fixed'} ${report.fixed.length} issue${
                report.fixed.length === 1 ? '' : 's'
              }:`,
            );
            for (const f of report.fixed) {
              display.line(`  ✓ ${f}`);
            }
          }
          if (report.warnings.length > 0) {
            logger.warn(
              `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}:`,
            );
            for (const w of report.warnings) {
              display.line(`  ⚠ ${w}`);
            }
          }
          return;
        }

        // No specId — scan all
        const { specsScanned, reports } = await syncAllSpecs(projectDir, config, {
          dryRun: opts.dryRun,
        });
        if (specsScanned === 0) {
          logger.info('No specs found.');
          return;
        }
        const totalFixed = reports.reduce((acc, r) => acc + r.fixed.length, 0);
        const totalWarnings = reports.reduce((acc, r) => acc + r.warnings.length, 0);

        logger.heading(`Sync — ${specsScanned} spec${specsScanned === 1 ? '' : 's'} scanned`);
        for (const r of reports) {
          if (r.fixed.length === 0 && r.warnings.length === 0) {
            display.line(`  ✓ ${r.specId} (${r.specSlug}) — clean`);
            continue;
          }
          display.line(`  ${r.specId} (${r.specSlug}):`);
          for (const f of r.fixed) display.line(`    ✓ ${f}`);
          for (const w of r.warnings) display.line(`    ⚠ ${w}`);
        }
        logger.dim('');
        logger.dim(
          `Summary: ${opts.dryRun ? 'would fix' : 'fixed'} ${totalFixed}, warnings ${totalWarnings}.`,
        );
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });
}
