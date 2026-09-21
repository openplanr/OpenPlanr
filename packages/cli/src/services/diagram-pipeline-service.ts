import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePipelinePackage } from './pipeline-package-service.js';
import { inspectRuntimeProjectContext } from './runtime-manager/inventory.js';

export type DiagramSourceChoice = 'ir' | 'mermaid' | 'excalidraw';

interface DiagramManifestOutput {
  path: string;
  mediaType: string;
  digest: string;
  fidelity: string;
}

interface DiagramManifest {
  kind: 'diagram-manifest';
  diagramId: string;
  documentDigest: string;
  source: { path: string; digest: string };
  registry: { grammarId: string; grammarVersion: string };
  outputs: DiagramManifestOutput[];
}

interface DiagramInspection {
  directory: string;
  manifest: DiagramManifest;
  validation: 'passed' | 'changed';
  sourceChanges: Array<Record<string, unknown>>;
  generatedChanges: Array<Record<string, unknown>>;
}

interface DiagramRuntimeApi {
  DIAGRAM_GRAMMARS: Array<Record<string, unknown>>;
  DIAGRAM_LAYOUT_FAMILIES: string[];
  DIAGRAM_PRIMITIVES: string[];
  assertDiagramDocument(document: Record<string, unknown>): Record<string, unknown>;
  assertExcalidrawScene(scene: Record<string, unknown>): Record<string, unknown>;
  createDiagramDocument(input: Record<string, unknown>): Record<string, unknown>;
  checkDiagram(options: { outputRoot: string; slug: string }): Promise<DiagramInspection>;
  getGrammar(grammarId: string): Record<string, unknown>;
  importMermaid(
    source: string,
    options: Record<string, unknown>,
  ): {
    document: Record<string, unknown>;
    fidelity: Record<string, unknown>;
  };
  inspectDiagram(options: { outputRoot: string; slug: string }): Promise<DiagramInspection>;
  renderDiagram(
    document: Record<string, unknown>,
    options: { outputRoot: string; slug: string },
  ): Promise<{ status: string; directory: string; manifest: DiagramManifest; outputCount: number }>;
  rerenderDiagram(options: {
    outputRoot: string;
    slug: string;
    acceptSource: DiagramSourceChoice | null;
  }): Promise<{
    status: string;
    directory: string;
    manifest: DiagramManifest;
    outputCount: number;
  }>;
}

export interface DiagramSuccessEnvelope {
  ok: true;
  action: string;
  status: string;
  diagramId?: string;
  directory?: string;
  disposable?: boolean;
  manifest?: { path: string; digest: string };
  artifacts: Array<{ path: string; mediaType: string; digest: string; fidelity: string }>;
  validation: { status: 'passed' | 'changed'; changes: Array<Record<string, unknown>> };
  quality?: DiagramQualitySummary;
  editability: Record<string, string>;
  fidelity: Record<string, string>;
  omissions: Array<{ format: string; reason: string }>;
  warnings: string[];
  nextAction: string | null;
  [key: string]: unknown;
}

export interface DiagramQualitySummary {
  status: 'pass' | 'warning' | 'invalid';
  failedChecks: string[];
  warningChecks: string[];
}

export class DiagramCommandError extends Error {
  readonly code: string;
  readonly recovery?: string;

  constructor(code: string, message: string, recovery?: string) {
    super(message);
    this.name = code;
    this.code = code;
    this.recovery = recovery;
  }

  toJSON(): Record<string, unknown> {
    return {
      ok: false,
      code: this.code,
      problem: this.message,
      ...(this.recovery ? { recovery: this.recovery } : {}),
    };
  }
}

let cachedRuntime: Promise<DiagramRuntimeApi> | undefined;

export function loadDiagramPipeline(): Promise<DiagramRuntimeApi> {
  if (cachedRuntime) return cachedRuntime;
  cachedRuntime = (async () => {
    const pipeline = resolvePipelinePackage(false);
    if (!pipeline) {
      throw new DiagramCommandError(
        'E_PIPELINE_NOT_INSTALLED',
        'Diagram rendering requires the full OpenPlanr workflow package.',
        'Install OpenPlanr with its optional planr-pipeline dependency, then retry.',
      );
    }
    const entry = path.join(pipeline.root, 'lib', 'artifact', 'diagram', 'index.mjs');
    if (!existsSync(entry)) {
      throw new DiagramCommandError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        `Installed planr-pipeline ${pipeline.version} does not include the diagram runtime.`,
        'Install a compatible OpenPlanr and planr-pipeline version pair.',
      );
    }
    const loaded = (await import(pathToFileURL(entry).href)) as Partial<DiagramRuntimeApi>;
    const required: Array<keyof DiagramRuntimeApi> = [
      'DIAGRAM_GRAMMARS',
      'DIAGRAM_LAYOUT_FAMILIES',
      'DIAGRAM_PRIMITIVES',
      'assertDiagramDocument',
      'assertExcalidrawScene',
      'createDiagramDocument',
      'checkDiagram',
      'getGrammar',
      'importMermaid',
      'inspectDiagram',
      'renderDiagram',
      'rerenderDiagram',
    ];
    const missing = required.filter((name) => loaded[name] === undefined);
    if (missing.length > 0) {
      throw new DiagramCommandError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        `Installed planr-pipeline ${pipeline.version} lacks diagram APIs: ${missing.join(', ')}.`,
        'Install a compatible OpenPlanr and planr-pipeline version pair.',
      );
    }
    return loaded as DiagramRuntimeApi;
  })();
  return cachedRuntime;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!slug || !/^[a-z]/u.test(slug)) return `diagram-${slug || 'untitled'}`;
  return slug;
}

function sourceStem(input: string): string {
  return path
    .basename(input)
    .replace(/\.planr-diagram\.json$/u, '')
    .replace(/\.manifest\.json$/u, '')
    .replace(/\.(?:mmd|mermaid|excalidraw|json)$/u, '');
}

async function workspaceRoot(
  projectDir: string,
  explicit?: string,
): Promise<{
  outputRoot: string;
  disposable: boolean;
}> {
  if (explicit) return { outputRoot: path.resolve(projectDir, explicit), disposable: false };
  if (inspectRuntimeProjectContext(projectDir).valid) {
    return { outputRoot: path.resolve(projectDir), disposable: false };
  }
  return {
    outputRoot: await mkdtemp(path.join(tmpdir(), 'openplanr-diagram-')),
    disposable: true,
  };
}

function absoluteArtifacts(outputRoot: string, manifest: DiagramManifest) {
  return manifest.outputs.map((output) => ({
    ...output,
    path: path.resolve(outputRoot, ...output.path.split('/')),
  }));
}

function projectionSummary(
  api: DiagramRuntimeApi,
  manifest: DiagramManifest,
  artifacts: Array<{ path: string; mediaType: string; digest: string; fidelity: string }>,
) {
  const grammar = api.getGrammar(manifest.registry.grammarId);
  const projections = grammar.projections as Record<string, string>;
  const emitted = (suffix: string) => artifacts.find(({ path: value }) => value.endsWith(suffix));
  const mermaid = emitted('.mmd');
  const excalidraw = emitted('.excalidraw');
  const omissions = [
    !mermaid && {
      format: 'mermaid',
      reason:
        projections.mermaid === 'unsupported'
          ? `The ${manifest.registry.grammarId} grammar has no certified Mermaid projection.`
          : 'The runtime did not emit a Mermaid projection.',
    },
    !excalidraw && {
      format: 'excalidraw',
      reason:
        projections.excalidraw === 'unsupported'
          ? `The ${manifest.registry.grammarId} grammar has no certified editable-scene projection.`
          : 'The runtime did not emit an editable scene.',
    },
  ].filter((value): value is { format: string; reason: string } => Boolean(value));
  return {
    editability: {
      source: manifest.source.path.endsWith('.excalidraw')
        ? 'excalidraw'
        : manifest.source.path.endsWith('.mmd')
          ? 'mermaid'
          : 'canonical-ir',
      mermaid: mermaid ? 'available' : 'omitted',
      excalidraw: excalidraw ? 'available' : 'omitted',
    },
    fidelity: {
      canonical: 'editable',
      mermaid: mermaid?.fidelity ?? projections.mermaid,
      excalidraw: excalidraw?.fidelity ?? projections.excalidraw,
      svg: emitted('.svg')?.fidelity ?? 'omitted',
      png: emitted('.png')?.fidelity ?? 'omitted',
    },
    omissions,
  };
}

interface QualityReportCheck {
  id: string;
  status: string;
  message?: string;
}

/**
 * Summarizes a rendered set's quality report.
 * An unusable report is reported as a warning with no summary, so `inspect` still explains a
 * set whose outputs are damaged.
 */
function readQuality(artifacts: Array<{ path: string }>): {
  summary: DiagramQualitySummary | null;
  warnings: string[];
} {
  const file = artifacts.find(({ path: value }) => value.endsWith('.quality.json'));
  if (!file) return { summary: null, warnings: [] };
  const unusable = (detail: string) => ({
    summary: null,
    warnings: [`Quality report is unusable and was not summarized: ${file.path}: ${detail}`],
  });
  let report: { status?: unknown; checks?: unknown };
  try {
    report = JSON.parse(readFileSync(file.path, 'utf8')) as { status?: unknown; checks?: unknown };
  } catch (error) {
    return unusable(`unreadable: ${(error as Error).message}`);
  }
  if (report.status !== 'pass' && report.status !== 'warning' && report.status !== 'invalid') {
    return unusable(`unknown status ${JSON.stringify(report.status)}`);
  }
  const checks = (Array.isArray(report.checks) ? report.checks : []) as QualityReportCheck[];
  return {
    summary: {
      status: report.status,
      failedChecks: checks.filter(({ status }) => status === 'fail').map(({ id }) => id),
      warningChecks: checks.filter(({ status }) => status === 'warning').map(({ id }) => id),
    },
    warnings: checks
      .filter(({ status }) => status === 'fail' || status === 'warning')
      .map(({ id, status, message }) => `Quality ${status} ${id}: ${message ?? 'no detail.'}`),
  };
}

function manifestEnvelope(
  api: DiagramRuntimeApi,
  action: string,
  outputRoot: string,
  result: {
    directory: string;
    manifest: DiagramManifest;
    validation?: 'passed' | 'changed';
    sourceChanges?: Array<Record<string, unknown>>;
    generatedChanges?: Array<Record<string, unknown>>;
    status?: string;
  },
  disposable = false,
): DiagramSuccessEnvelope {
  const artifacts = absoluteArtifacts(outputRoot, result.manifest);
  const changes = [...(result.sourceChanges ?? []), ...(result.generatedChanges ?? [])];
  const validation = result.validation ?? (changes.length > 0 ? 'changed' : 'passed');
  const projection = projectionSummary(api, result.manifest, artifacts);
  const quality = readQuality(artifacts);
  const html = artifacts.find(({ path: value }) => value.endsWith('.html'));
  const manifestPath = path.join(result.directory, `${result.manifest.diagramId}.manifest.json`);
  return {
    ok: true,
    action,
    status: result.status ?? validation,
    diagramId: result.manifest.diagramId,
    directory: result.directory,
    disposable,
    manifest: {
      path: manifestPath,
      digest: result.manifest.documentDigest,
    },
    artifacts,
    validation: { status: validation, changes },
    ...(quality.summary ? { quality: quality.summary } : {}),
    ...projection,
    warnings: [
      ...(changes.length > 0 ? ['Diagram files differ from the recorded manifest.'] : []),
      ...quality.warnings,
    ],
    // An invalid set is not reviewable, so it gets no handover action.
    nextAction:
      html && quality.summary?.status !== 'invalid'
        ? `planr artifact open ${JSON.stringify(manifestPath)} --json`
        : null,
  };
}

async function readJsonObject(input: string): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(input, 'utf8'));
  } catch (error) {
    throw new DiagramCommandError(
      'E_DIAGRAM_INPUT_INVALID',
      'Diagram JSON input could not be read or parsed.',
      error instanceof Error ? error.message : 'Provide a readable JSON file.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DiagramCommandError(
      'E_DIAGRAM_INPUT_INVALID',
      'Diagram JSON input must be an object.',
    );
  }
  return value as Record<string, unknown>;
}

export async function renderDiagramInput(options: {
  projectDir: string;
  input: string;
  output?: string;
  slug?: string;
}): Promise<DiagramSuccessEnvelope> {
  const api = await loadDiagramPipeline();
  const input = path.resolve(options.projectDir, options.input);
  const slug = slugify(options.slug ?? sourceStem(input));
  let document: Record<string, unknown>;
  if (/\.(?:mmd|mermaid)$/iu.test(input)) {
    const source = await readFile(input, 'utf8');
    document = api.importMermaid(source, {
      diagramId: slug,
      title: sourceStem(input),
      summary: `Imported Mermaid diagram from ${path.basename(input)}.`,
      sourcePath: options.input.replaceAll(path.sep, '/'),
    }).document;
  } else {
    const value = await readJsonObject(input);
    if (value.type === 'excalidraw') {
      api.assertExcalidrawScene(value);
      throw new DiagramCommandError(
        'E_DIAGRAM_SCENE_NEEDS_MANIFEST',
        'An editable scene needs its canonical diagram manifest before it can own a rerender.',
        'Place the edited scene in an existing diagram set and run planr diagram rerender <manifest> --accept excalidraw.',
      );
    }
    document =
      typeof value.documentDigest === 'string'
        ? api.assertDiagramDocument(value)
        : api.createDiagramDocument(value);
  }
  if (typeof document.diagramId !== 'string') {
    throw new DiagramCommandError(
      'E_DIAGRAM_INPUT_INVALID',
      'Canonical diagram input has no diagramId.',
    );
  }
  const effectiveSlug = options.slug ? slug : document.diagramId;
  const workspace = await workspaceRoot(options.projectDir, options.output);
  const result = await api.renderDiagram(document, {
    outputRoot: workspace.outputRoot,
    slug: effectiveSlug,
  });
  return manifestEnvelope(
    api,
    'diagram.rendered',
    workspace.outputRoot,
    result,
    workspace.disposable,
  );
}

function manifestLocation(input: string): {
  outputRoot: string;
  slug: string;
  manifest: DiagramManifest;
} {
  let target = input;
  if (statSync(target).isDirectory()) {
    const slug = path.basename(target);
    target = path.join(target, `${slug}.manifest.json`);
  }
  const manifest = JSON.parse(readFileSync(target, 'utf8')) as DiagramManifest;
  if (manifest.kind !== 'diagram-manifest' || typeof manifest.diagramId !== 'string') {
    throw new DiagramCommandError(
      'E_DIAGRAM_MANIFEST_INVALID',
      'Input is not an OpenPlanr diagram manifest.',
    );
  }
  const directory = path.dirname(target);
  const diagramsRoot = path.dirname(directory);
  if (
    path.basename(diagramsRoot) !== 'diagrams' ||
    path.basename(directory) !== manifest.diagramId
  ) {
    throw new DiagramCommandError(
      'E_DIAGRAM_MANIFEST_LOCATION_INVALID',
      'Diagram manifest is outside its diagrams/{slug}/ custody directory.',
    );
  }
  return { outputRoot: path.dirname(diagramsRoot), slug: manifest.diagramId, manifest };
}

async function inspectSource(
  api: DiagramRuntimeApi,
  action: string,
  input: string,
): Promise<DiagramSuccessEnvelope> {
  if (/\.(?:mmd|mermaid)$/iu.test(input)) {
    const slug = slugify(sourceStem(input));
    const imported = api.importMermaid(await readFile(input, 'utf8'), {
      diagramId: slug,
      title: sourceStem(input),
      summary: `Imported Mermaid diagram from ${path.basename(input)}.`,
      sourcePath: path.basename(input),
    });
    return {
      ok: true,
      action,
      status: 'passed',
      diagramId: slug,
      artifacts: [],
      validation: { status: 'passed', changes: [] },
      editability: { source: 'mermaid' },
      fidelity: { import: String(imported.fidelity.status ?? 'partial') },
      omissions: [],
      warnings: [],
      nextAction: `planr diagram render ${JSON.stringify(input)} --json`,
    };
  }
  const value = await readJsonObject(input);
  if (value.type === 'excalidraw') {
    api.assertExcalidrawScene(value);
    return {
      ok: true,
      action,
      status: 'passed',
      artifacts: [],
      validation: { status: 'passed', changes: [] },
      editability: { source: 'excalidraw' },
      fidelity: { scene: 'editable' },
      omissions: [],
      warnings: ['A standalone scene has no canonical manifest custody yet.'],
      nextAction: null,
    };
  }
  const document = api.assertDiagramDocument(value);
  return {
    ok: true,
    action,
    status: 'passed',
    diagramId: String(document.diagramId),
    artifacts: [],
    validation: { status: 'passed', changes: [] },
    editability: { source: 'canonical-ir' },
    fidelity: {},
    omissions: [],
    warnings: [],
    nextAction: `planr diagram render ${JSON.stringify(input)} --json`,
  };
}

export async function inspectDiagramInput(options: {
  projectDir: string;
  input: string;
  check?: boolean;
}): Promise<DiagramSuccessEnvelope> {
  const api = await loadDiagramPipeline();
  const input = path.resolve(options.projectDir, options.input);
  if (!existsSync(input)) {
    throw new DiagramCommandError('E_DIAGRAM_INPUT_MISSING', 'Diagram input does not exist.');
  }
  if (!input.endsWith('.manifest.json') && !statSync(input).isDirectory()) {
    return inspectSource(api, options.check ? 'diagram.checked' : 'diagram.inspected', input);
  }
  const location = manifestLocation(input);
  const result = options.check
    ? await api.checkDiagram({ outputRoot: location.outputRoot, slug: location.slug })
    : await api.inspectDiagram({ outputRoot: location.outputRoot, slug: location.slug });
  return manifestEnvelope(
    api,
    options.check ? 'diagram.checked' : 'diagram.inspected',
    location.outputRoot,
    result,
  );
}

export async function rerenderDiagramInput(options: {
  projectDir: string;
  manifest: string;
  accept?: DiagramSourceChoice;
}): Promise<DiagramSuccessEnvelope> {
  const api = await loadDiagramPipeline();
  const location = manifestLocation(path.resolve(options.projectDir, options.manifest));
  const result = await api.rerenderDiagram({
    outputRoot: location.outputRoot,
    slug: location.slug,
    acceptSource: options.accept ?? null,
  });
  return manifestEnvelope(api, 'diagram.rerendered', location.outputRoot, result);
}

export async function diagramGallery(type?: string): Promise<Record<string, unknown>> {
  const api = await loadDiagramPipeline();
  const normalized = type?.trim().toLowerCase();
  const grammars = normalized
    ? api.DIAGRAM_GRAMMARS.filter(
        (grammar) =>
          grammar.grammarId === normalized ||
          grammar.layoutFamily === normalized ||
          (grammar.aliases as string[]).includes(normalized),
      )
    : api.DIAGRAM_GRAMMARS;
  if (normalized && grammars.length === 0) {
    throw new DiagramCommandError(
      'E_DIAGRAM_GRAMMAR_UNKNOWN',
      `No diagram grammar or layout family matches ${type}.`,
      'Run planr diagram gallery --json to list supported types.',
    );
  }
  return {
    ok: true,
    action: 'diagram.gallery',
    status: 'passed',
    count: grammars.length,
    grammars,
    primitives: api.DIAGRAM_PRIMITIVES,
    layoutFamilies: api.DIAGRAM_LAYOUT_FAMILIES,
    nextAction: 'Choose a grammar, then invoke planr-diagram or render a canonical input.',
  };
}
