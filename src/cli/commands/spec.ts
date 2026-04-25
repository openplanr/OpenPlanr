/**
 * `planr spec` command group — spec-driven planning mode.
 *
 * The third planning posture alongside agile (epic/feature/story/task) and
 * QT (quick task). Specs decompose into nested User Stories and Tasks with
 * the same artifact contract as the `openplanr-pipeline` Claude Code plugin
 * (file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD
 * with build/test commands). Pairs with the pipeline plugin via shared
 * schema — no conversion layer ever.
 *
 * See `docs/proposals/spec-driven-mode.md` for the full design.
 *
 * Subcommands shipped in this scaffolding release:
 *   - planr spec init           Activate spec-driven mode in this project
 *   - planr spec create <title> Create a new SPEC artifact
 *   - planr spec list           List all specs in the project
 *   - planr spec show <id>      Print a spec + its US/Task tree
 *   - planr spec status [id]    Decomposition state per spec
 *   - planr spec destroy <id>   Remove a spec entirely (clean rm -rf of one dir)
 *   - planr spec attach-design <id> --files <png>...   Attach UI mockups
 *   - planr spec promote <id>   Validate + print pipeline handoff command
 *
 * Deferred to follow-up PRs (per the design doc):
 *   - planr spec shape <id>     Interactive 4-question SPEC authoring
 *   - planr spec decompose <id> AI-driven US + Task generation
 *   - planr spec sync           Repair orphaned/dangling artifacts
 */

import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../../services/config-service.js';
import { requireInteractiveForManual } from '../../services/interactive-state.js';
import {
  promptConfirm,
  promptEditor,
  promptMultiText,
  promptText,
} from '../../services/prompt-service.js';
import {
  attachSpecDesigns,
  createSpec,
  decomposeSpec,
  destroySpec,
  getSpecStatus,
  listSpecStories,
  listSpecs,
  listSpecTasks,
  readSpec,
  resolveSpecDir,
  type ShapeSpecAnswers,
  shapeSpec,
  updateSpecFields,
  validateSpecForPromotion,
} from '../../services/spec-service.js';
import { display, logger } from '../../utils/logger.js';

export function registerSpecCommand(program: Command) {
  const spec = program
    .command('spec')
    .description(
      'Spec-driven planning mode — author specs that decompose into agent-executable tasks. Pairs with openplanr-pipeline.',
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
      display.line(
        '  3. Decompose:        planr spec decompose <SPEC-id>     (AI mode, follow-up PR)',
      );
      display.line('  4. Review:           planr spec show <SPEC-id>');
      display.line('  5. Promote:          planr spec promote <SPEC-id>');
      display.line('  6. Ship via plugin:  /openplanr-pipeline:plan <slug>     (in Claude Code)');
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
        const { id, slug, specDir, specFile } = await createSpec(projectDir, config, title, {
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
        display.line(`  - Or use guided authoring:      planr spec shape ${id}     (follow-up PR)`);
        display.line(
          `  - Attach UI mockups (optional): planr spec attach-design ${id} --files <png>...`,
        );
        display.line(
          `  - Decompose into US + Tasks:    planr spec decompose ${id}  (follow-up PR)`,
        );
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
    .description(
      'Interactive 4-question SPEC authoring (Context, Functional Requirements, Business Rules, Acceptance Criteria)',
    )
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .action(async (specId: string) => {
      const projectDir = program.opts().projectDir as string;
      const config = await loadConfig(projectDir);

      // shape is interactive by definition. If the user is in --no-interactive
      // mode, refuse with a helpful message. (Same pattern as `--manual`
      // in `planr quick create` — see requireInteractiveForManual.)
      requireInteractiveForManual(true);

      const spec = await readSpec(projectDir, config, specId);
      if (!spec) {
        logger.error(`Spec ${specId} not found.`);
        process.exit(1);
      }

      logger.heading(`Shape ${spec.id}: ${spec.data.title || spec.slug}`);
      logger.dim('4 questions. Answers populate the spec body.');
      logger.dim('Press Ctrl+C at any time to abort without saving.');
      logger.dim('');

      // ── Question 1 — Context ────────────────────────────────────────────
      logger.dim('Question 1 of 4 — Context');
      const context = await promptEditor(
        'What problem does this feature solve? Who is the primary user? (opens your $EDITOR)',
        '',
      );
      if (!context.trim()) {
        logger.error('Context cannot be empty. Aborting.');
        process.exit(1);
      }

      // ── Question 2 — Functional requirements ────────────────────────────
      logger.dim('');
      logger.dim('Question 2 of 4 — Functional Requirements');
      const functionalRequirements = await promptMultiText(
        'What must the system DO? (comma-separated; one observable behavior per item)',
        'e.g., "user can log in", "system validates password complexity", "session expires after 30min"',
      );
      if (functionalRequirements.length === 0) {
        logger.error('At least one functional requirement is required. Aborting.');
        process.exit(1);
      }

      // ── Question 3 — Business rules / constraints ───────────────────────
      logger.dim('');
      logger.dim('Question 3 of 4 — Business Rules & Constraints (optional)');
      const businessRules = await promptEditor(
        'Any rules, limits, or constraints? (permissions, validations, dependencies — leave empty if none)',
        '',
      );

      // ── Question 4 — Acceptance criteria ────────────────────────────────
      logger.dim('');
      logger.dim('Question 4 of 4 — Acceptance Criteria');
      const acceptanceCriteria = await promptMultiText(
        'How will you know this feature is done? (Given/When/Then format recommended; comma-separated)',
        'e.g., "Given a logged-out user, when they submit valid creds, then they reach /dashboard"',
      );
      if (acceptanceCriteria.length === 0) {
        logger.error('At least one acceptance criterion is required. Aborting.');
        process.exit(1);
      }

      // ── Optional: out-of-scope items + decomposition notes ──────────────
      logger.dim('');
      const wantExtras = await promptConfirm(
        'Add Out-of-Scope items or Notes for Decomposition? (optional)',
        false,
      );
      let outOfScope: string[] = [];
      let decompositionNotes = '';
      if (wantExtras) {
        outOfScope = await promptMultiText(
          'Out of Scope (comma-separated; what this feature does NOT include)',
          'e.g., "email notifications (covered in feat-notifications)"',
        );
        decompositionNotes = await promptEditor(
          'Notes for `planr spec decompose` (hints to guide the AI; not business requirements)',
          '',
        );
      }

      // ── Confirm + write ─────────────────────────────────────────────────
      logger.dim('');
      const ok = await promptConfirm(`Update ${spec.id} body with these answers?`, true);
      if (!ok) {
        logger.info('Cancelled.');
        return;
      }

      const answers: ShapeSpecAnswers = {
        context,
        functionalRequirements,
        businessRules,
        outOfScope,
        acceptanceCriteria,
        decompositionNotes,
      };

      try {
        const { specFile } = await shapeSpec(projectDir, config, specId, answers);
        logger.success(`Shaped ${spec.id}.`);
        logger.dim(`  ${specFile}`);
        logger.dim(`  Status: pending → shaping`);
        logger.dim('');
        display.line('Next steps:');
        display.line(`  - Review the spec:           planr spec show ${spec.id}`);
        display.line(`  - Decompose into US + Tasks: planr spec decompose ${spec.id}  (AI-driven)`);
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });

  // ------------------------------------------------------------------------
  // planr spec decompose <id>
  // ------------------------------------------------------------------------
  spec
    .command('decompose')
    .description(
      'AI-driven decomposition of a SPEC into User Stories + Tasks (matches openplanr-pipeline schema)',
    )
    .argument('<specId>', 'spec ID (e.g., SPEC-001)')
    .option('--force', 'overwrite existing US/Task files (use after `planr spec destroy` failed)')
    .option(
      '--no-code-context',
      'skip the codebase scanner (faster; tasks reference generic paths)',
    )
    .option('--max-stories <n>', 'cap the number of stories the AI emits (1-8)', (v) =>
      Number.parseInt(v, 10),
    )
    .action(
      async (
        specId: string,
        opts: { force?: boolean; codeContext?: boolean; maxStories?: number },
      ) => {
        const projectDir = program.opts().projectDir as string;
        const config = await loadConfig(projectDir);

        const spec = await readSpec(projectDir, config, specId);
        if (!spec) {
          logger.error(`Spec ${specId} not found.`);
          process.exit(1);
        }

        const { isAIConfigured } = await import('../../services/ai-service.js');
        if (!isAIConfigured(config)) {
          logger.error(
            'AI is not configured. Set ANTHROPIC_API_KEY (or another provider key) and `planr config set-provider`.',
          );
          process.exit(1);
        }

        logger.heading(`Decompose ${spec.id}: ${spec.data.title || spec.slug}`);
        logger.dim(
          opts.codeContext === false
            ? '  (--no-code-context: skipping codebase scan)'
            : '  Analyzing spec + codebase...',
        );

        try {
          const result = await decomposeSpec(projectDir, config, specId, {
            force: opts.force ?? false,
            // commander stores boolean negation as `codeContext` (default true; --no-code-context → false)
            noCodeContext: opts.codeContext === false,
            maxStories: opts.maxStories,
          });

          logger.success(
            `Decomposed ${spec.id}: ${result.storiesCreated} stor${
              result.storiesCreated === 1 ? 'y' : 'ies'
            }, ${result.tasksCreated} tasks.`,
          );
          if (result.decompositionNotes) {
            logger.dim('');
            logger.dim(`AI notes: ${result.decompositionNotes}`);
          }
          logger.dim('');
          display.line('Next steps:');
          display.line(`  - Review the tree:   planr spec show ${spec.id}`);
          display.line(`  - Validate + handoff: planr spec promote ${spec.id}`);
        } catch (err) {
          // Try to surface AI errors with friendly messaging if applicable
          try {
            const { handleAIError } = await import('../helpers/task-creation.js');
            await handleAIError(err);
          } catch {
            logger.error((err as Error).message);
          }
          process.exit(1);
        }
      },
    );

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
        display.line('  Stories:   (none — run `planr spec decompose` to generate)');
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
      display.line(`  Pipeline handoff: /openplanr-pipeline:plan ${spec.slug}`);
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
          `When you run /openplanr-pipeline:plan, the designer-agent will analyze these PNGs into design/design-spec.md.`,
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

      logger.success(`${specId} is ready for openplanr-pipeline.`);
      logger.dim('');
      display.line('Next: in Claude Code, run:');
      display.line(`  /openplanr-pipeline:plan ${spec.slug}`);
      display.line('');
      display.line('After human review of the decomposition:');
      display.line(`  /openplanr-pipeline:ship ${spec.slug}`);
      display.line('');
      logger.dim(
        `(The pipeline plugin reads .planr/specs/${spec.id}-${spec.slug}/ directly when spec mode is active.)`,
      );
    });
}
