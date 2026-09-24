import type { Command } from 'commander';
import {
  applyDiagramTransaction,
  DiagramAuthoringError,
  editDiagram,
  newDiagram,
} from '../../../services/diagram-authoring-service.js';
import {
  type DiagramSourceChoice,
  diagramGallery,
  inspectDiagramInput,
  renderDiagramInput,
  rerenderDiagramInput,
} from '../../../services/diagram-pipeline-service.js';
import { display, logger } from '../../../utils/logger.js';
import { presentDiagramGallery, presentDiagramResult } from './presentation.js';

interface RenderOptions {
  json?: boolean;
  output?: string;
  slug?: string;
}

interface InspectOptions {
  json?: boolean;
}

interface GalleryOptions {
  json?: boolean;
  type?: string;
}

interface RerenderOptions {
  accept?: string;
  json?: boolean;
}

interface AuthoringOptions {
  json?: boolean;
  title?: string;
  transaction?: string;
  dryRun?: boolean;
  accept?: string;
}

function presentAuthoring(value: Record<string, unknown>, json: boolean): void {
  if (json) {
    display.line(JSON.stringify(value));
    return;
  }
  logger.success(`${String(value.diagramId)}: ${String(value.status)}`);
  if (value.path) display.keyValue('Bundle', String(value.path));
  if (value.url) display.keyValue('Studio', String(value.url));
  if (value.diff) display.line(JSON.stringify(value.diff, null, 2));
  if (value.nextAction) display.line(`Next: ${String(value.nextAction)}`);
}

function projectDir(program: Command): string {
  return program.opts().projectDir as string;
}

function sourceChoice(value?: string): DiagramSourceChoice | undefined {
  if (value === undefined) return undefined;
  if (['ir', 'mermaid', 'excalidraw'].includes(value)) return value as DiagramSourceChoice;
  const error = new Error('Diagram source must be ir, mermaid, or excalidraw.');
  error.name = 'E_DIAGRAM_SOURCE_INVALID';
  throw error;
}

export function registerDiagramCommand(program: Command): void {
  const diagram = program
    .command('diagram')
    .description('Create, verify, inspect, and rerender offline professional diagrams');

  diagram
    .command('new')
    .argument('<path>', 'canonical diagrams/{slug}/{slug}.planr-diagram-bundle.json path')
    .requiredOption('--title <title>', 'diagram title')
    .option('--json', 'output one stable machine envelope')
    .description('Create a canonical editable diagram bundle')
    .action(async (input: string, options: AuthoringOptions) => {
      presentAuthoring(
        await newDiagram(projectDir(program), input, options.title ?? ''),
        Boolean(options.json),
      );
    });

  diagram
    .command('edit')
    .argument('<path>', 'canonical diagram bundle path')
    .option('--json', 'output one stable machine envelope')
    .description('Open the local owner studio for an existing diagram')
    .action(async (input: string, options: AuthoringOptions) => {
      const owner = await editDiagram(projectDir(program), input);
      presentAuthoring(
        { ok: true, action: 'diagram.edit', status: 'open', diagramId: input, url: owner.baseUrl },
        Boolean(options.json),
      );
      let stop: (() => void) | undefined;
      try {
        await new Promise<void>((resolve) => {
          stop = resolve;
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });
      } finally {
        if (stop) {
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
        }
        await owner.close();
      }
    });

  diagram
    .command('apply')
    .argument('<path>', 'canonical diagram bundle path')
    .requiredOption('--transaction <file>', 'typed diagram-edit-transaction JSON')
    .option('--dry-run', 'preview semantic and layout changes without applying')
    .option('--accept <preview-token>', 'apply the exact previewed transaction')
    .option('--json', 'output one stable machine envelope')
    .description('Preview a scoped edit, then explicitly accept that preview')
    .action(async (input: string, options: AuthoringOptions) => {
      if (options.dryRun && options.accept)
        throw new DiagramAuthoringError(
          'E_DIAGRAM_OPTIONS',
          '--dry-run and --accept cannot be used together.',
        );
      presentAuthoring(
        await applyDiagramTransaction(
          projectDir(program),
          input,
          options.transaction ?? '',
          options.accept,
        ),
        Boolean(options.json),
      );
    });

  diagram
    .command('render')
    .argument('<input>', 'canonical .planr-diagram.json or Mermaid source')
    .description('Render a verified offline diagram set')
    .option('--slug <slug>', 'override the output slug')
    .option('--output <directory>', 'output root; defaults to the repository root')
    .option('--json', 'output one stable machine envelope')
    .action(async (input: string, options: RenderOptions) => {
      presentDiagramResult(
        await renderDiagramInput({
          projectDir: projectDir(program),
          input,
          output: options.output,
          slug: options.slug,
        }),
        Boolean(options.json),
      );
    });

  for (const [name, description, check] of [
    ['inspect', 'Inspect source or generated manifest custody', false],
    ['check', 'Validate source or verify generated bytes against their manifest', true],
  ] as const) {
    diagram
      .command(name)
      .argument('<input-or-manifest>', 'diagram source, manifest, or generated diagram directory')
      .description(description)
      .option('--json', 'output one stable machine envelope')
      .action(async (input: string, options: InspectOptions) => {
        presentDiagramResult(
          await inspectDiagramInput({
            projectDir: projectDir(program),
            input,
            check,
          }),
          Boolean(options.json),
        );
      });
  }

  diagram
    .command('gallery')
    .description('List the searchable diagram grammar and primitive gallery')
    .option('--type <type>', 'filter by grammar, alias, or layout family')
    .option('--json', 'output one stable machine envelope')
    .action(async (options: GalleryOptions) => {
      presentDiagramGallery(await diagramGallery(options.type), Boolean(options.json));
    });

  diagram
    .command('rerender')
    .argument('<manifest>', 'generated diagram manifest')
    .description('Rerender after an intentional source edit')
    .option('--accept <source>', 'choose ir, mermaid, or excalidraw when source branches conflict')
    .option('--json', 'output one stable machine envelope')
    .action(async (manifest: string, options: RerenderOptions) => {
      presentDiagramResult(
        await rerenderDiagramInput({
          projectDir: projectDir(program),
          manifest,
          accept: sourceChoice(options.accept),
        }),
        Boolean(options.json),
      );
    });
}
