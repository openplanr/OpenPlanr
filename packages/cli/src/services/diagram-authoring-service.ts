import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDiagramOwner } from './diagram-artifact-service.js';
import { DiagramCommandError } from './diagram-pipeline-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';

type Bundle = { diagramId: string; bundleDigest: string };
type Transaction = {
  diagramId: string;
  transactionId: string;
  base: unknown;
  operations: unknown[];
};
type Diagnostic = { path: string; rule: string; detail: string };
type Preview =
  | {
      ok: true;
      diff: { semantic: unknown[]; presentation: unknown[] };
      impact: { affectedIds: string[] };
    }
  | { ok: false; diagnostics: Diagnostic[] };
type StoreRead =
  | { ok: true; status: 'ready'; bundle: Bundle; byteDigest: string; path: string }
  | { ok: true; status: 'absent'; path: string }
  | { ok: false; status: 'unknown'; reason: string };
type Store = {
  path: string;
  read(): Promise<StoreRead>;
  initialize(
    bundle: Bundle,
    identity: { transactionId: string },
  ): Promise<{ ok: boolean; status: string; receipt?: unknown; reason?: string }>;
  preview(transaction: Transaction): Promise<Preview>;
  commit(
    transaction: Transaction,
  ): Promise<{ ok: boolean; status: string; receipt?: unknown; reason?: string }>;
  commitSnapshot(
    bundle: Bundle,
    identity: {
      transactionId: string;
      expectedBase: {
        byteDigest: string;
        basis: { bundleDigest: string; semanticDigest: string; presentationDigest: string };
      };
    },
  ): Promise<{ ok: boolean; status: string; receipt?: unknown; reason?: string }>;
  history(page?: { limit?: number }): Promise<Array<{ transactionId: string }>>;
};
type Runtime = {
  createDiagramAuthoringStore(options: { root: string; slug: string }): Store;
  createDiagramEditorDraft(options: {
    diagramId: string;
    title: string;
  }): { ok: true; bundle: Bundle } | { ok: false; diagnostics: Diagnostic[] };
};

export class DiagramAuthoringError extends DiagramCommandError {
  readonly details?: { diagnostics: Diagnostic[] };

  constructor(code: string, message: string, diagnostics?: Diagnostic[]) {
    super(code, message);
    if (diagnostics) this.details = { diagnostics };
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.details ? { diagnostics: this.details.diagnostics } : {}),
    };
  }
}

async function runtime(): Promise<Runtime> {
  const pipeline = resolvePipelinePackage(false);
  if (!pipeline)
    throw new DiagramAuthoringError(
      'E_PIPELINE_NOT_INSTALLED',
      'Diagram authoring requires the OpenPlanr workflow package.',
    );
  const [store, editor] = await Promise.all([
    import(
      pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram/authoring/store.mjs')).href
    ),
    import(pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram/editor/index.mjs')).href),
  ]);
  if (
    typeof store.createDiagramAuthoringStore !== 'function' ||
    typeof editor.createDiagramEditorDraft !== 'function'
  )
    throw new DiagramAuthoringError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The installed workflow package does not support diagram authoring.',
    );
  return {
    createDiagramAuthoringStore: store.createDiagramAuthoringStore,
    createDiagramEditorDraft: editor.createDiagramEditorDraft,
  } as Runtime;
}

export async function canonicalDiagramTarget(
  projectDir: string,
  input: string,
): Promise<{ root: string; slug: string; file: string }> {
  const root = await realpath(projectDir);
  const absolute = path.resolve(root, input);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  const match = /^diagrams\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\/\1\.planr-diagram-bundle\.json$/u.exec(
    relative,
  );
  if (!match)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_PATH',
      'Select a canonical path under diagrams/{slug}/{slug}.planr-diagram-bundle.json.',
    );
  // Refuse a path through a symlink even before the store acquires custody.
  let cursor = root;
  for (const part of relative.split('/').slice(0, -1)) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new DiagramAuthoringError(
        'E_DIAGRAM_PATH',
        'Diagram paths cannot contain symbolic links.',
      );
    if (info && !info.isDirectory())
      throw new DiagramAuthoringError(
        'E_DIAGRAM_PATH',
        'Diagram path parents must be directories.',
      );
    if (!info) break;
  }
  return { root, slug: match[1], file: absolute };
}

async function ownedStore(
  projectDir: string,
  input: string,
): Promise<{ slug: string; store: Store; file: string }> {
  const target = await canonicalDiagramTarget(projectDir, input);
  const store = (await runtime()).createDiagramAuthoringStore({
    root: target.root,
    slug: target.slug,
  });
  return { slug: target.slug, store, file: target.file };
}

function ready(read: StoreRead): Extract<StoreRead, { status: 'ready' }> {
  if (!read.ok) throw new DiagramAuthoringError('E_DIAGRAM_RECOVERY_REQUIRED', read.reason);
  if (read.status === 'absent')
    throw new DiagramAuthoringError('E_DIAGRAM_NOT_FOUND', 'Create the diagram before editing it.');
  return read;
}

export async function newDiagram(projectDir: string, input: string, title: string) {
  if (!title.trim() || title.length > 240)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_TITLE',
      'Provide a title between 1 and 240 characters.',
    );
  const { slug, store, file } = await ownedStore(projectDir, input);
  const draft = (await runtime()).createDiagramEditorDraft({
    diagramId: slug,
    title: title.trim(),
  });
  if (!draft.ok)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_SCHEMA_INVALID',
      'The new diagram is invalid.',
      draft.diagnostics,
    );
  const saved = await store.initialize(draft.bundle, { transactionId: `init-${randomUUID()}` });
  if (!saved.ok)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_RECOVERY_REQUIRED',
      saved.reason ?? 'Diagram creation needs recovery.',
    );
  return {
    ok: true as const,
    action: 'diagram.new',
    status: saved.status,
    diagramId: slug,
    path: file,
    receipt: saved.receipt,
  };
}

/** Adopt a validated remote bundle through the same atomic local store as new/edit. */
export async function adoptDiagramBundle(
  projectDir: string,
  input: string,
  bundle: Bundle,
  remoteDigest: string,
) {
  const { slug, store, file } = await ownedStore(projectDir, input);
  if (bundle.diagramId !== slug)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_IDENTITY',
      'The selected bundle identity does not match its local target.',
    );
  const transactionId = `adopt-${remoteDigest.slice(0, 32)}`;
  const prior = await store.read();
  if (prior.ok && prior.status === 'ready') {
    const history = await store.history({ limit: 1000 });
    if (
      prior.bundle.bundleDigest !== bundle.bundleDigest ||
      !history.some((entry) => entry.transactionId === transactionId)
    )
      throw new DiagramAuthoringError(
        'E_DIAGRAM_COLLISION',
        'The selected local diagram already has different custody.',
      );
    return { path: file, bundle: prior.bundle, replayed: true };
  }
  if (!prior.ok) throw new DiagramAuthoringError('E_DIAGRAM_RECOVERY_REQUIRED', prior.reason);
  const saved = await store.initialize(bundle, { transactionId });
  if (!saved.ok)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_RECOVERY_REQUIRED',
      saved.reason ?? 'Diagram adoption needs recovery.',
    );
  return { path: file, bundle: ready(await store.read()).bundle, replayed: false };
}

/** Commit a reviewed complete successor without bypassing the authoring store's recovery journal. */
export async function commitReviewedDiagramSuccessor(
  projectDir: string,
  input: string,
  bundle: Bundle,
  transactionId: string,
  expectedBase: {
    byteDigest: string;
    basis: { bundleDigest: string; semanticDigest: string; presentationDigest: string };
  },
) {
  const { slug, store, file } = await ownedStore(projectDir, input);
  if (bundle.diagramId !== slug)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_IDENTITY',
      'The successor bundle identity does not match its local target.',
    );
  const saved = await store.commitSnapshot(bundle, { transactionId, expectedBase });
  if (!saved.ok)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_RECOVERY_REQUIRED',
      saved.reason ?? 'The complete-bundle commit needs recovery.',
    );
  return { path: file, receipt: saved.receipt };
}

export async function editDiagram(projectDir: string, input: string) {
  const { slug, store } = await ownedStore(projectDir, input);
  ready(await store.read());
  return openDiagramOwner({ root: projectDir, slug });
}

export async function applyDiagramTransaction(
  projectDir: string,
  input: string,
  transactionFile: string,
  accept?: string,
) {
  const { slug, store, file } = await ownedStore(projectDir, input);
  const transactionPath = path.resolve(projectDir, transactionFile);
  const info = await lstat(transactionPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_TRANSACTION_FILE',
      'Select a regular transaction JSON file no larger than 16 MiB.',
    );
  let transaction: Transaction;
  try {
    transaction = JSON.parse(await readFile(transactionPath, 'utf8')) as Transaction;
  } catch {
    throw new DiagramAuthoringError(
      'E_DIAGRAM_TRANSACTION_FILE',
      'The transaction file must contain valid JSON.',
    );
  }
  const current = ready(await store.read());
  const preview = await store.preview(transaction);
  if (!preview.ok)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_TRANSACTION_INVALID',
      'The transaction cannot be applied to the current bundle.',
      preview.diagnostics,
    );
  const previewToken = createHash('sha256')
    .update(JSON.stringify([slug, current.byteDigest, transaction]))
    .digest('hex');
  if (!accept)
    return {
      ok: true as const,
      action: 'diagram.apply',
      status: 'preview',
      diagramId: slug,
      path: file,
      baseBytesDigest: current.byteDigest,
      previewToken,
      diff: preview.diff,
      impact: preview.impact,
      nextAction: `planr diagram apply ${input} --transaction ${transactionFile} --accept ${previewToken}`,
    };
  if (accept !== previewToken)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_PREVIEW_CHANGED',
      'The preview token no longer matches the exact current bundle and transaction.',
    );
  const saved = await store.commit(transaction);
  if (!saved.ok)
    throw new DiagramAuthoringError(
      'E_DIAGRAM_RECOVERY_REQUIRED',
      saved.reason ?? 'Diagram commit needs recovery.',
    );
  return {
    ok: true as const,
    action: 'diagram.apply',
    status: saved.status,
    diagramId: slug,
    path: file,
    receipt: saved.receipt,
    diff: preview.diff,
  };
}
