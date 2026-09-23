import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCompanyAccessToken } from './company-auth-service.js';
import { CompanySyncError, normalizeCompanyOrigin } from './company-common.js';
import {
  adoptDiagramBundle,
  canonicalDiagramTarget,
  commitReviewedDiagramSuccessor,
} from './diagram-authoring-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export {
  CompanySyncError,
  DEFAULT_COMPANY_API_ORIGIN,
  normalizeCompanyOrigin,
  resolveCompanyOrigin,
} from './company-common.js';

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new CompanySyncError(code, message, cause === undefined ? undefined : { cause });
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const id = (value: unknown): string =>
  typeof value === 'string' &&
  value.trim() === value &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
    ? value
    : fail('E_COMPANY_ID', 'Invalid company resource identifier.');
const MAX_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export interface CompanyPreview {
  schemaVersion: '1.0.0';
  id: string;
  apiUrl: string;
  projectId: string;
  filePath: string;
  title: string;
  kind: 'diagram' | 'design' | 'plan' | 'document';
  contentType: string;
  contentDigest: string;
  /** Canonical local bytes can differ from the immutable remote revision's bytes after adoption. */
  localContentDigest?: string;
  byteLength: number;
  createdAt: string;
  artifactId?: string;
  revisionId?: string;
  organizationId?: string;
  sourceType?: 'design-document';
  sourceFiles?: string[];
  sourceDigests?: Record<string, string>;
  designSummary?: {
    designId: string;
    screenCount: number;
    frameCount: number;
    variantCount: number;
  };
}
export interface CompanyBinding extends CompanyPreview {
  artifactId: string;
  revisionId: string;
  organizationId: string;
}
interface CompanyPushPreview extends CompanyBinding {
  operationId: string;
  publishedRevisionId?: string;
}
const expectedLocalDigest = (binding: CompanyBinding): string =>
  binding.localContentDigest ?? binding.contentDigest;
type CompanyLayout = Record<string, { x: number; y: number }>;
interface PendingApplication {
  schemaVersion: '1.0.0';
  status: 'pending-local-application';
  bindingId: string;
  proposalId: string;
  apiUrl: string;
  organizationId: string;
  projectId: string;
  artifactId: string;
  filePath: string;
  baseRevisionId: string;
  baseDigest: string;
  resultDigest: string;
  baseLayoutDigest: string;
  resultLayoutDigest: string;
  layout: CompanyLayout;
  backupId: string;
  preparedAt: string;
  semanticChanged: boolean;
  layoutChanged: boolean;
}
// Reject C0 controls and DEL in externally supplied paths and element identifiers.
function hasControlCharacters(value: string): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}
const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/.test(value);
function layoutDigest(layout: CompanyLayout): string {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout))
    return fail('E_COMPANY_STATE', 'Invalid company layout state.');
  const entries = Object.entries(layout).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [key, point] of entries) {
    if (
      !key ||
      key.length > 512 ||
      /\s/u.test(key) ||
      hasControlCharacters(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !point ||
      typeof point !== 'object' ||
      Array.isArray(point) ||
      Object.keys(point).length !== 2 ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.abs(point.x) > 1e7 ||
      Math.abs(point.y) > 1e7
    )
      return fail('E_COMPANY_STATE', 'Invalid company layout coordinates.');
  }
  return hash(JSON.stringify(entries));
}

function assertSafeRelativePath(relative: string): void {
  if (
    typeof relative !== 'string' ||
    !relative ||
    hasControlCharacters(relative) ||
    /^[A-Za-z]:/u.test(relative) ||
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative
      .split('/')
      .some((part) => ['.', '..', '.git', 'node_modules', '.ssh', '.local', ''].includes(part)) ||
    /(?:^|\/)(?:\.env(?:\.|$)|credentials(?:\.|$)|id_rsa|id_ed25519)/i.test(relative)
  )
    fail(
      'E_COMPANY_SCOPE',
      'Select a repository-relative artifact file, excluding secrets and internal state.',
    );
}
async function safeFile(root: string, relative: string): Promise<string> {
  assertSafeRelativePath(relative);
  const base = await realpath(root);
  let current = base;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink())
      return fail('E_COMPANY_SCOPE', 'Artifact paths must not contain symbolic links.');
  }
  const stat = await lstat(current);
  if (!stat.isFile() || stat.size > MAX_BYTES)
    return fail('E_COMPANY_SIZE', 'Select a regular artifact file no larger than 1 MiB.');
  return current;
}
async function readArtifactFile(file: string): Promise<string> {
  const bytes = await readFile(file);
  if (bytes.byteLength > MAX_BYTES)
    return fail('E_COMPANY_SIZE', 'Artifact exceeds the 1 MiB publication limit.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (cause) {
    return fail(
      'E_COMPANY_ENCODING',
      'Artifact content must be valid UTF-8; no bytes were transformed or published.',
      cause,
    );
  }
}
const stateSizeLimit = (section: string) =>
  ['layouts', 'applications', 'pending-applications', 'application-content', 'backups'].includes(
    section,
  )
    ? MAX_BYTES
    : 65536;
async function safeStateDirectory(root: string, section: string): Promise<string> {
  const base = await realpath(root);
  let current = base;
  for (const part of ['.local', 'company', section]) {
    current = path.join(current, part);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      return fail('E_COMPANY_SCOPE', 'Company local state must not contain symbolic links.');
  }
  return current;
}
async function statePath(root: string, section: string, key: string) {
  return path.join(await safeStateDirectory(root, section), `${id(key)}.json`);
}
async function syncDirectory(directory: string) {
  // Windows does not support opening directories for FlushFileBuffers.
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function replaceDurably(
  target: string,
  content: string,
  mode = 0o600,
  beforeRename?: () => Promise<void>,
) {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', mode);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (beforeRename) await beforeRename();
    await rename(temp, target);
    await syncDirectory(path.dirname(target));
  } finally {
    await unlink(temp).catch(() => {});
  }
}
async function saveState(root: string, section: string, key: string, value: unknown) {
  const target = await statePath(root, section, key);
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > stateSizeLimit(section))
    return fail('E_COMPANY_STATE', 'Company local state exceeds its supported size.');
  await replaceDurably(target, serialized);
}
async function readStoredContent(root: string, section: string, key: string): Promise<string> {
  const target = await statePath(root, section, key);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES)
    return fail('E_COMPANY_STATE', 'Invalid staged company content.');
  return readArtifactFile(target);
}
async function readState(root: string, section: string, key: string): Promise<unknown> {
  const target = await statePath(root, section, key);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > stateSizeLimit(section))
    return fail('E_COMPANY_STATE', 'Invalid company local state.');
  try {
    return JSON.parse(await readArtifactFile(target));
  } catch (cause) {
    return fail('E_COMPANY_STATE', 'Company local state is not valid JSON.', cause);
  }
}
async function loadState(root: string, section: string, key: string): Promise<CompanyPreview> {
  const data = (await readState(root, section, key)) as CompanyPreview;
  if (
    !data ||
    typeof data !== 'object' ||
    data.schemaVersion !== '1.0.0' ||
    data.id !== key ||
    typeof data.contentDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.contentDigest) ||
    (data.localContentDigest !== undefined && !isDigest(data.localContentDigest)) ||
    typeof data.filePath !== 'string' ||
    typeof data.title !== 'string' ||
    !data.title.trim() ||
    data.title.length > 240 ||
    !['diagram', 'design', 'plan', 'document'].includes(data.kind) ||
    !['application/json', 'text/markdown', 'image/svg+xml', 'text/html'].includes(
      data.contentType,
    ) ||
    !Number.isSafeInteger(data.byteLength) ||
    data.byteLength < 0 ||
    data.byteLength > MAX_BYTES ||
    typeof data.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(data.createdAt))
  )
    return fail('E_COMPANY_STATE', 'Invalid or unsupported publication preview.');
  if (data.sourceType !== undefined) {
    if (
      data.sourceType !== 'design-document' ||
      data.kind !== 'design' ||
      data.contentType !== 'application/json' ||
      !Array.isArray(data.sourceFiles) ||
      !data.sourceFiles.length ||
      data.sourceFiles.length > 2048 ||
      new Set(data.sourceFiles).size !== data.sourceFiles.length ||
      !data.sourceFiles.includes(data.filePath) ||
      !data.sourceDigests ||
      typeof data.sourceDigests !== 'object' ||
      Array.isArray(data.sourceDigests) ||
      Object.keys(data.sourceDigests).length !== data.sourceFiles.length ||
      data.sourceFiles.some((file) => !isDigest(data.sourceDigests?.[file]))
    )
      return fail('E_COMPANY_STATE', 'Invalid design publication source manifest.');
    for (const file of data.sourceFiles) assertSafeRelativePath(file);
  } else if (data.sourceFiles !== undefined || data.sourceDigests !== undefined) {
    return fail(
      'E_COMPANY_STATE',
      'A source manifest requires an explicit publication source type.',
    );
  }
  normalizeCompanyOrigin(data.apiUrl);
  id(data.projectId);
  if (data.artifactId !== undefined) {
    id(data.artifactId);
    id(data.organizationId);
  }
  if (data.revisionId !== undefined) {
    id(data.revisionId);
    if (!data.artifactId)
      return fail('E_COMPANY_STATE', 'A revision requires an artifact binding.');
  }
  if (section === 'bindings' || section === 'push-previews') {
    id(data.artifactId);
    id(data.revisionId);
    id(data.organizationId);
  }
  if (section === 'push-previews') {
    id((data as CompanyPushPreview).operationId);
    if ((data as CompanyPushPreview).publishedRevisionId !== undefined)
      id((data as CompanyPushPreview).publishedRevisionId);
  }
  return data;
}
async function withBindingLock<T>(
  root: string,
  bindingId: string,
  action: () => Promise<T>,
): Promise<T> {
  const lockPath = (await statePath(root, 'bindings', bindingId)) + '.lock';
  const owner = { pid: process.pid, nonce: randomUUID() };
  const ownerPath = `${lockPath}.${owner.nonce}.owner`;
  const serialized = JSON.stringify(owner);
  await replaceDurably(ownerPath, serialized);
  let acquired = false;
  try {
    for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
      try {
        await link(ownerPath, lockPath);
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const info = await lstat(lockPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024)
          return fail('E_COMPANY_STATE', 'Invalid company binding lock.');
        const previous = await readFile(lockPath, 'utf8');
        let stale: { pid: number; nonce: string };
        try {
          stale = JSON.parse(previous);
        } catch (cause) {
          return fail(
            'E_COMPANY_BUSY',
            'An older binding lock needs inspection before recovery.',
            cause,
          );
        }
        if (!Number.isSafeInteger(stale.pid) || stale.pid < 1)
          return fail('E_COMPANY_STATE', 'Invalid company lock owner.');
        id(stale.nonce);
        try {
          process.kill(stale.pid, 0);
          return fail(
            'E_COMPANY_BUSY',
            'Another operation is using this binding. Retry after it finishes.',
          );
        } catch (check) {
          if ((check as NodeJS.ErrnoException).code !== 'ESRCH') throw check;
        }
        // Only one process may reclaim a particular dead owner. Recheck its nonce
        // while holding that claim so an overlapping retry cannot remove a new lock.
        const claimPath = `${lockPath}.recovery-${stale.nonce}`;
        let claim: Awaited<ReturnType<typeof open>>;
        try {
          claim = await open(claimPath, 'wx', 0o600);
        } catch (cause) {
          return fail(
            'E_COMPANY_BUSY',
            'This binding is being recovered. Retry after recovery finishes.',
            cause,
          );
        }
        try {
          if ((await readFile(lockPath, 'utf8')) === previous) await unlink(lockPath);
        } catch (check) {
          if ((check as NodeJS.ErrnoException).code !== 'ENOENT') throw check;
        } finally {
          await claim.close();
          await unlink(claimPath);
        }
      }
    }
    if (!acquired)
      return fail('E_COMPANY_BUSY', 'The binding lock changed during recovery. Retry shortly.');
    return await action();
  } finally {
    if (acquired) {
      const current = await readFile(lockPath, 'utf8').catch(() => '');
      if (current === serialized) await unlink(lockPath);
    }
    await unlink(ownerPath).catch(() => {});
  }
}
async function loadLayout(root: string, bindingId: string): Promise<CompanyLayout> {
  let value: { schemaVersion: string; bindingId: string; layout: CompanyLayout } | undefined;
  try {
    value = (await readState(root, 'layouts', bindingId)) as typeof value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (
    value?.schemaVersion !== '1.0.0' ||
    value.bindingId !== bindingId ||
    !value.layout ||
    typeof value.layout !== 'object' ||
    Array.isArray(value.layout)
  )
    return fail('E_COMPANY_STATE', 'Invalid company layout state.');
  layoutDigest(value.layout);
  return value.layout;
}
function checkContent(content: string) {
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk_live_|ghp_)[A-Za-z0-9]{20,}|(?:authorization["']?\s*[:=]\s*["']?bearer\s+)[A-Za-z0-9._-]{20,}/i.test(
      content,
    )
  )
    fail(
      'E_COMPANY_SENSITIVE',
      'This artifact appears to contain credentials. Remove them before sharing.',
    );
}
async function diagramAuthoringRuntime() {
  const pipeline = resolvePipelinePackage(true);
  if (!pipeline) return fail('E_COMPANY_RUNTIME', 'The diagram authoring runtime is unavailable.');
  const runtime = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram/authoring/index.mjs')).href
  );
  if (
    typeof runtime.validateAuthoringBundle !== 'function' ||
    typeof runtime.diffDiagramBundles !== 'function'
  )
    return fail(
      'E_COMPANY_RUNTIME',
      'The installed workflow package does not support complete diagram bundles.',
    );
  return runtime;
}
async function assertCompleteDiagramBundle(content: unknown, filePath?: string) {
  const checked = (await diagramAuthoringRuntime()).validateAuthoringBundle(content);
  if (!checked.ok)
    return fail('E_COMPANY_AUTHORING', 'The complete diagram bundle is invalid or unsupported.');
  const bundle = content as { diagramId: string };
  if (
    filePath &&
    filePath !== `diagrams/${bundle.diagramId}/${bundle.diagramId}.planr-diagram-bundle.json`
  )
    return fail('E_COMPANY_SCOPE', 'Publish the canonical diagram-authoring-bundle file.');
  return bundle;
}
interface PreparedCompanyContent {
  content: string;
  contentType: string;
  sourceType?: 'design-document';
  sourceFiles?: string[];
  sourceDigests?: Record<string, string>;
  designSummary?: CompanyPreview['designSummary'];
  warnings?: string[];
}
type PrepareDesignPublication = (
  file: string,
  options: { maxBytes: number },
) => Promise<{
  content: string;
  sourceFiles: string[];
  sourceDigests: Record<string, string>;
  byteLength: number;
  designId: string;
  screenCount: number;
  frameCount: number;
  variantCount: number;
  warnings?: string[];
}>;
async function prepareCompanyContent(
  root: string,
  source: Pick<CompanyPreview, 'filePath' | 'kind' | 'sourceType'>,
  detectDesign = false,
): Promise<PreparedCompanyContent> {
  const file = await safeFile(root, source.filePath);
  const extension = path.extname(file).toLowerCase();
  const contentType = (
    {
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.svg': 'image/svg+xml',
      '.html': 'text/html',
    } as Record<string, string>
  )[extension];
  if (!contentType)
    return fail('E_COMPANY_TYPE', 'Publish a JSON, Markdown, SVG, or HTML artifact.');
  const original = await readArtifactFile(file);
  checkContent(original);
  if (source.kind === 'diagram' && extension === '.json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(original);
    } catch {
      /* Legacy JSON validation remains at its domain boundary. */
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { kind?: unknown }).kind === 'diagram-authoring-bundle'
    )
      await assertCompleteDiagramBundle(parsed, source.filePath);
  }
  let isDesignDocument = false;
  if (source.kind === 'design' && extension === '.json') {
    try {
      isDesignDocument = JSON.parse(original).kind === 'openplanr-design-document';
    } catch {
      /* Ordinary JSON validation belongs to its domain. */
    }
  }
  if (source.sourceType === 'design-document' && !isDesignDocument)
    return fail(
      'E_COMPANY_CHANGED',
      'The selected design document changed type. Create a new publication preview.',
    );
  if (source.sourceType !== 'design-document' && !(detectDesign && isDesignDocument))
    return { content: original, contentType };
  const pipeline = resolvePipelinePackage(true);
  if (!pipeline)
    return fail(
      'E_COMPANY_DESIGN_RUNTIME',
      'The design publication runtime is unavailable. Run planr doctor to inspect the installed runtime.',
    );
  let prepareDesign: PrepareDesignPublication;
  try {
    ({ prepareCompanyDesignPublication: prepareDesign } = await import(
      pathToFileURL(path.join(pipeline.root, 'lib/design/company-publication.mjs')).href
    ));
  } catch (cause) {
    return fail(
      'E_COMPANY_DESIGN_RUNTIME',
      'The resolved pipeline does not provide design publication. Run planr doctor to inspect the installed runtime.',
      cause,
    );
  }
  if (typeof prepareDesign !== 'function')
    return fail(
      'E_COMPANY_DESIGN_RUNTIME',
      'The resolved pipeline does not provide design publication. Run planr doctor to inspect the installed runtime.',
    );
  const prepared = await prepareDesign(file, { maxBytes: MAX_BYTES });
  if (
    typeof prepared.content !== 'string' ||
    !Array.isArray(prepared.sourceFiles) ||
    !prepared.sourceFiles.length ||
    !prepared.sourceDigests ||
    prepared.byteLength !== Buffer.byteLength(prepared.content) ||
    prepared.byteLength > MAX_BYTES
  )
    return fail(
      'E_COMPANY_DESIGN_RUNTIME',
      'The design publication runtime returned an invalid or oversized bundle.',
    );
  const sourceDigests: Record<string, string> = Object.create(null);
  for (const relative of prepared.sourceFiles) {
    assertSafeRelativePath(relative);
    const repositoryPath = path.posix.join(path.posix.dirname(source.filePath), relative);
    assertSafeRelativePath(repositoryPath);
    const resolved = await safeFile(root, repositoryPath);
    const bytes = await readFile(resolved);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== prepared.sourceDigests[relative])
      return fail(
        'E_COMPANY_CHANGED',
        'A design source changed while preparing publication. Create a new preview.',
      );
    if (Object.hasOwn(sourceDigests, repositoryPath))
      return fail(
        'E_COMPANY_DESIGN_RUNTIME',
        'The design publication contains duplicate source paths.',
      );
    sourceDigests[repositoryPath] = digest;
  }
  if (!Object.hasOwn(sourceDigests, source.filePath))
    return fail(
      'E_COMPANY_DESIGN_RUNTIME',
      'The design publication omitted its selected source document.',
    );
  checkContent(prepared.content);
  return {
    content: prepared.content,
    contentType: 'application/json',
    sourceType: 'design-document',
    sourceFiles: Object.keys(sourceDigests).sort(),
    sourceDigests,
    designSummary: {
      designId: prepared.designId,
      screenCount: prepared.screenCount,
      frameCount: prepared.frameCount,
      variantCount: prepared.variantCount,
    },
    warnings: prepared.warnings ?? [],
  };
}
function sameSourceManifest(left: CompanyPreview, right: PreparedCompanyContent): boolean {
  return (
    left.sourceType === right.sourceType &&
    JSON.stringify(
      [...(left.sourceFiles ?? [])].sort().map((file) => [file, left.sourceDigests?.[file]]),
    ) ===
      JSON.stringify(
        [...(right.sourceFiles ?? [])].sort().map((file) => [file, right.sourceDigests?.[file]]),
      )
  );
}
function publicationSourceDigest(
  contentDigest: string,
  source: Pick<CompanyPreview, 'sourceType' | 'sourceFiles' | 'sourceDigests'>,
): string {
  return source.sourceType === 'design-document'
    ? hash(
        JSON.stringify([
          contentDigest,
          [...(source.sourceFiles ?? [])]
            .sort()
            .map((file) => [file, source.sourceDigests?.[file]]),
        ]),
      )
    : contentDigest;
}
function publicPreview<T extends CompanyPreview>(preview: T) {
  const { sourceDigests: _privateDigests, ...visible } = preview;
  return visible;
}
function requireApplicableSource(binding: CompanyBinding) {
  if (binding.sourceType === 'design-document')
    return fail(
      'E_COMPANY_AUTHORING',
      'Packaged design proposals cannot be applied over an authored design document. Review the handoff, edit its declared source files locally, then preview a company push.',
    );
}
export async function previewCompanyPublication(
  root: string,
  options: {
    filePath: string;
    apiUrl: string;
    projectId: string;
    title?: string;
    kind?: CompanyPreview['kind'];
  },
) {
  const kind = options.kind ?? 'document';
  const prepared = await prepareCompanyContent(root, { filePath: options.filePath, kind }, true);
  const { content, warnings: _warnings, ...source } = prepared;
  const preview: CompanyPreview = {
    schemaVersion: '1.0.0',
    id: randomUUID(),
    apiUrl: normalizeCompanyOrigin(options.apiUrl),
    projectId: id(options.projectId),
    filePath: options.filePath,
    title: options.title ?? path.basename(options.filePath),
    kind,
    ...source,
    contentDigest: hash(content),
    byteLength: Buffer.byteLength(content),
    createdAt: new Date().toISOString(),
  };
  if (
    !['diagram', 'design', 'plan', 'document'].includes(preview.kind) ||
    !preview.title.trim() ||
    preview.title.length > 240
  )
    return fail('E_COMPANY_INPUT', 'Supply a valid artifact kind and title.');
  await saveState(root, 'previews', preview.id, preview);
  return {
    ok: true,
    action: 'company.preview',
    status: 'preview',
    preview: publicPreview(preview),
    selectedFiles: preview.sourceFiles ?? [preview.filePath],
    content,
    ...(prepared.warnings?.length ? { warnings: prepared.warnings } : {}),
    notice:
      preview.sourceType === 'design-document'
        ? 'Only the listed design document and its referenced files will be shared. Review this exact scope and content before invoking company publish.'
        : 'Only this file will be shared. Review the content before invoking company publish.',
  };
}
type CompanyRequestOptions = {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  token?: string;
};
async function companyResponse(
  apiUrl: string,
  route: string,
  options: CompanyRequestOptions = {},
): Promise<Response> {
  const origin = normalizeCompanyOrigin(apiUrl);
  if (
    !route.startsWith('/v1/') ||
    route.includes('..') ||
    route.includes('\\') ||
    route.includes('#')
  )
    return fail('E_COMPANY_ROUTE', 'Invalid company route.');
  const token = options.token ?? (await resolveCompanyAccessToken(origin));
  if (!token)
    return fail(
      'E_COMPANY_AUTH',
      'Sign in using `planr company login`. Developer endpoint and token overrides remain available.',
    );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(origin + route, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch (cause) {
    return fail(
      'E_COMPANY_UNAVAILABLE',
      'The company service could not be reached. Local work is unchanged; retry later.',
      cause,
    );
  }
  if (response.status === 401 && options.token === undefined) {
    const renewed = await resolveCompanyAccessToken(origin, { rejectedAccessToken: token });
    if (renewed) {
      await response.body?.cancel();
      headers.Authorization = `Bearer ${renewed}`;
      try {
        response = await fetch(origin + route, {
          method: options.method ?? 'GET',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
      } catch (cause) {
        return fail(
          'E_COMPANY_UNAVAILABLE',
          'The company service could not be reached. Local work is unchanged; retry later.',
          cause,
        );
      }
    }
  }
  if (!response.ok)
    return fail(
      response.status === 409
        ? 'E_COMPANY_CONFLICT'
        : response.status === 401 || response.status === 403
          ? 'E_COMPANY_AUTH'
          : 'E_COMPANY_REQUEST',
      response.status === 409
        ? 'The remote revision changed. Refresh and compare before publishing.'
        : `Company request failed (${response.status}). No server response content was logged.`,
    );
  return response;
}
async function readCompanyBody(
  response: Response,
  limit: number,
  preserveBom = false,
): Promise<{ content: string; byteLength: number }> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    return fail('E_COMPANY_RESPONSE', 'The company response exceeded its supported size.');
  }
  let received = 0;
  let content = '';
  try {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: preserveBom });
    if (!reader) return { content: '', byteLength: 0 };
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > limit)
          return fail('E_COMPANY_RESPONSE', 'The company response exceeded its supported size.');
        content += decoder.decode(chunk.value, { stream: true });
      }
      content += decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    return { content, byteLength: received };
  } catch (error) {
    if (error instanceof CompanySyncError) throw error;
    return fail(
      'E_COMPANY_RESPONSE',
      'The company service returned an invalid response. No response content was logged.',
    );
  }
}
export async function companyApi<T>(
  apiUrl: string,
  route: string,
  options: CompanyRequestOptions = {},
): Promise<T> {
  const { content } = await readCompanyBody(
    await companyResponse(apiUrl, route, options),
    MAX_RESPONSE_BYTES,
  );
  try {
    return JSON.parse(content) as T;
  } catch (cause) {
    return fail(
      'E_COMPANY_RESPONSE',
      'The company service returned an invalid response. No response content was logged.',
      cause,
    );
  }
}
export async function publishCompanyPreview(root: string, previewId: string) {
  return withBindingLock(root, previewId, async () => {
    const preview = await loadState(root, 'previews', previewId);
    const replayed = Boolean(preview.revisionId);
    const prepared = await prepareCompanyContent(root, preview);
    const { content } = prepared;
    if (hash(content) !== preview.contentDigest || !sameSourceManifest(preview, prepared))
      return fail(
        'E_COMPANY_CHANGED',
        'The file or a referenced design source changed after preview. Create a new preview before sharing.',
      );
    checkContent(content);
    const base = `/v1/projects/${id(preview.projectId)}/artifacts`;
    if (!preview.artifactId) {
      const result = await companyApi<{
        artifact: { id: string; organizationId: string; projectId: string };
      }>(preview.apiUrl, base, {
        method: 'POST',
        body: { title: preview.title, kind: preview.kind },
        idempotencyKey: preview.id + '-create',
      });
      if (result?.artifact?.projectId !== preview.projectId)
        return fail('E_COMPANY_RESPONSE', 'The returned artifact belongs to a different project.');
      preview.artifactId = id(result.artifact.id);
      preview.organizationId = id(result.artifact.organizationId);
      await saveState(root, 'previews', preview.id, preview);
    }
    if (!preview.revisionId) {
      const result = await companyApi<{
        revision: {
          id: string;
          organizationId: string;
          projectId: string;
          artifactId: string;
          parentRevisionId: null;
          contentDigest: string;
        };
      }>(preview.apiUrl, `${base}/${id(preview.artifactId)}/revisions`, {
        method: 'POST',
        body: { baseRevisionId: null, content, contentType: preview.contentType },
        idempotencyKey: preview.id + '-publish',
      });
      if (
        result?.revision?.organizationId !== preview.organizationId ||
        result.revision.projectId !== preview.projectId ||
        result.revision.artifactId !== preview.artifactId ||
        result.revision.parentRevisionId !== null ||
        result.revision.contentDigest !== preview.contentDigest
      )
        return fail(
          'E_COMPANY_RESPONSE',
          'The returned revision does not match the reviewed publication.',
        );
      preview.revisionId = id(result.revision.id);
      await saveState(root, 'previews', preview.id, preview);
    }
    let existing: CompanyBinding | undefined;
    try {
      existing = (await loadState(root, 'bindings', preview.id)) as CompanyBinding;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      existing &&
      (existing.artifactId !== preview.artifactId ||
        existing.organizationId !== preview.organizationId)
    )
      return fail(
        'E_COMPANY_STATE',
        'This preview conflicts with its existing publication binding.',
      );
    if (!existing) await saveState(root, 'bindings', preview.id, preview);
    return {
      ok: true,
      action: 'company.publish',
      status: replayed ? 'already-published' : 'synchronized',
      bindingId: preview.id,
      artifactId: preview.artifactId,
      revisionId: existing?.revisionId ?? preview.revisionId,
      ...(replayed
        ? {
            publishedRevisionId: preview.revisionId,
            synchronization: 'not-checked',
            notice:
              'This publication completed earlier. Its receipt was preserved; run company status to check current local and remote revisions.',
          }
        : {}),
    };
  });
}
export async function companyBindingStatus(root: string, bindingId: string) {
  const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
  const prepared = await prepareCompanyContent(root, binding);
  const current = prepared.content;
  const remote = await companyApi<{
    artifact: { id: string; organizationId: string; projectId: string };
    headRevisionId: string | null;
  }>(binding.apiUrl, `/v1/projects/${id(binding.projectId)}/artifacts/${id(binding.artifactId)}`);
  if (
    remote?.artifact?.id !== binding.artifactId ||
    remote.artifact.organizationId !== binding.organizationId ||
    remote.artifact.projectId !== binding.projectId ||
    remote.headRevisionId === null
  )
    return fail('E_COMPANY_RESPONSE', 'The remote artifact does not match its local binding.');
  id(remote.headRevisionId);
  const localChanged =
    hash(current) !== expectedLocalDigest(binding) || !sameSourceManifest(binding, prepared);
  const remoteChanged = remote.headRevisionId !== binding.revisionId;
  return {
    ok: true,
    action: 'company.status',
    status:
      localChanged && remoteChanged
        ? 'conflicted'
        : localChanged
          ? 'local-changes'
          : remoteChanged
            ? 'remote-changes'
            : 'synchronized',
    filePath: binding.filePath,
    artifactId: binding.artifactId,
    revisionId: binding.revisionId,
    remoteRevisionId: remote.headRevisionId,
  };
}

interface CompanyRemoteRevision {
  kind: 'openplanr-enterprise-artifact-revision';
  schemaVersion: '1.0.0';
  id: string;
  organizationId: string;
  projectId: string;
  artifactId: string;
  parentRevisionId: string | null;
  contentDigest: string;
  contentType: string;
  byteLength: number;
  createdAt: string;
  actorId: string;
}
interface CompanyPullPreview {
  schemaVersion: '1.0.0';
  id: string;
  bindingId: string;
  apiUrl: string;
  organizationId: string;
  projectId: string;
  artifactId: string;
  filePath: string;
  baseRevisionId: string;
  baseDigest: string;
  localDigest: string | null;
  selection: 'latest' | 'revision';
  remoteHeadRevisionId: string;
  revision: CompanyRemoteRevision;
  createdAt: string;
}
const companyArtifactRoute = (binding: CompanyBinding) =>
  `/v1/projects/${id(binding.projectId)}/artifacts/${id(binding.artifactId)}`;
async function boundLocalDigest(root: string, binding: CompanyBinding): Promise<string | null> {
  try {
    const prepared = await prepareCompanyContent(root, binding);
    return publicationSourceDigest(hash(prepared.content), prepared);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function boundRemoteHead(binding: CompanyBinding): Promise<string> {
  const result = await companyApi<{
    artifact: { id: string; organizationId: string; projectId: string };
    headRevisionId: string | null;
  }>(binding.apiUrl, companyArtifactRoute(binding));
  if (
    result?.artifact?.id !== binding.artifactId ||
    result.artifact.organizationId !== binding.organizationId ||
    result.artifact.projectId !== binding.projectId
  )
    return fail('E_COMPANY_SCOPE', 'The remote artifact does not match its publication binding.');
  if (result.headRevisionId === null)
    return fail('E_COMPANY_REVISION', 'The remote artifact has no published revision.');
  return id(result.headRevisionId);
}
async function assertRemoteRevision(
  binding: CompanyBinding,
  revision: unknown,
): Promise<CompanyRemoteRevision> {
  const runtime = await enterpriseRuntime();
  try {
    runtime.assertEnterpriseRevision(revision);
  } catch (cause) {
    return fail(
      'E_COMPANY_RESPONSE',
      'The remote revision metadata is invalid or unsupported.',
      cause,
    );
  }
  const selected = revision as CompanyRemoteRevision;
  if (
    selected.organizationId !== binding.organizationId ||
    selected.projectId !== binding.projectId ||
    selected.artifactId !== binding.artifactId
  )
    return fail('E_COMPANY_SCOPE', 'The revision belongs to a different publication scope.');
  if (selected.byteLength > MAX_BYTES)
    return fail('E_COMPANY_SIZE', 'The remote revision exceeds the 1 MiB retrieval limit.');
  return selected;
}
async function findRemoteRevision(
  binding: CompanyBinding,
  revisionId: string,
): Promise<CompanyRemoteRevision> {
  id(revisionId);
  let cursor = 0;
  for (let page = 0; page < 200; page++) {
    const result = await companyApi<{ revisions: unknown[]; nextCursor: number | null }>(
      binding.apiUrl,
      `${companyArtifactRoute(binding)}/revisions?cursor=${cursor}`,
    );
    if (!Array.isArray(result?.revisions) || result.revisions.length > 50)
      return fail('E_COMPANY_RESPONSE', 'The remote revision page is invalid.');
    let selected: CompanyRemoteRevision | undefined;
    for (const value of result.revisions) {
      const revision = await assertRemoteRevision(binding, value);
      if (revision.id === revisionId) {
        if (selected)
          return fail('E_COMPANY_RESPONSE', 'The revision page contains duplicate identities.');
        selected = revision;
      }
    }
    if (selected) return selected;
    if (result.nextCursor === null)
      return fail('E_COMPANY_REVISION', 'The requested revision does not exist in this artifact.');
    if (!Number.isSafeInteger(result.nextCursor) || result.nextCursor <= cursor)
      return fail('E_COMPANY_RESPONSE', 'The remote revision cursor is invalid.');
    cursor = result.nextCursor;
  }
  return fail(
    'E_COMPANY_HISTORY_LIMIT',
    'The revision history exceeds the supported retrieval window; no revision was selected.',
  );
}
async function remoteRevisionContent(
  binding: CompanyBinding,
  revision: CompanyRemoteRevision,
): Promise<string> {
  const response = await companyResponse(
    binding.apiUrl,
    `${companyArtifactRoute(binding)}/content?revisionId=${id(revision.id)}`,
  );
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const digestHeader = response.headers.get('x-openplanr-content-digest');
  const etag = response.headers.get('etag');
  const etagDigest = etag?.match(/^(?:W\/)?"([a-f0-9]{64})"$/)?.[1];
  if (
    contentType !== revision.contentType ||
    (digestHeader !== null && digestHeader !== revision.contentDigest) ||
    (etag !== null && etagDigest !== revision.contentDigest)
  ) {
    await response.body?.cancel();
    return fail(
      'E_COMPANY_INTEGRITY',
      'The downloaded content headers do not match the selected revision.',
    );
  }
  const { content, byteLength } = await readCompanyBody(response, MAX_BYTES, true);
  if (byteLength !== revision.byteLength || hash(content) !== revision.contentDigest)
    return fail(
      'E_COMPANY_INTEGRITY',
      'The downloaded bytes do not match the selected revision digest and size.',
    );
  return content;
}

export async function previewCompanyDiagramAdoption(
  root: string,
  options: {
    apiUrl: string;
    projectId: string;
    artifactId: string;
    revisionId: string;
    filePath: string;
  },
) {
  const apiUrl = normalizeCompanyOrigin(options.apiUrl);
  const projectId = id(options.projectId);
  const artifactId = id(options.artifactId);
  const revisionId = id(options.revisionId);
  assertSafeRelativePath(options.filePath);
  const target = await canonicalDiagramTarget(root, options.filePath);
  const remote = await companyApi<{
    artifact: { id: string; organizationId: string; projectId: string; kind: string };
  }>(apiUrl, `/v1/projects/${projectId}/artifacts/${artifactId}`);
  if (
    remote?.artifact?.id !== artifactId ||
    remote.artifact.projectId !== projectId ||
    remote.artifact.kind !== 'diagram'
  )
    return fail(
      'E_COMPANY_SCOPE',
      'The selected artifact is not a diagram in this company project.',
    );
  const organizationId = id(remote.artifact.organizationId);
  const provisional = { apiUrl, organizationId, projectId, artifactId } as CompanyBinding;
  const revision = await findRemoteRevision(provisional, revisionId);
  if (revision.contentType !== 'application/json')
    return fail('E_COMPANY_TYPE', 'Adoption requires a complete JSON diagram bundle.');
  const content = await remoteRevisionContent(provisional, revision);
  let bundle: unknown;
  try {
    bundle = JSON.parse(content);
  } catch {
    return fail('E_COMPANY_AUTHORING', 'The selected revision is not a JSON diagram bundle.');
  }
  if (
    !bundle ||
    typeof bundle !== 'object' ||
    (bundle as { kind?: unknown }).kind !== 'diagram-authoring-bundle'
  )
    return fail(
      'E_COMPANY_AUTHORING',
      'The selected revision is not a complete diagram-authoring-bundle.',
    );
  await assertCompleteDiagramBundle(bundle, options.filePath);
  if ((bundle as { diagramId: string }).diagramId !== target.slug)
    return fail(
      'E_COMPANY_SCOPE',
      'The selected revision identity does not match the local diagram path.',
    );
  const previewToken = hash(
    JSON.stringify([
      apiUrl,
      organizationId,
      projectId,
      artifactId,
      revisionId,
      revision.contentDigest,
      options.filePath,
    ]),
  );
  let collision = false;
  try {
    const info = await lstat(target.file);
    collision =
      !info.isFile() ||
      info.isSymbolicLink() ||
      hash(await readArtifactFile(target.file)) !== hash(JSON.stringify(bundle, null, 2) + '\n');
    if (!collision) {
      // Matching loose bytes are not enough: only the authoring store can own a bundle.
      const owner = await lstat(
        path.join(path.dirname(target.file), '.authoring', 'owner.json'),
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      collision = !owner?.isFile() || owner.isSymbolicLink();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const entries = await readdir(path.dirname(target.file)).catch(
      (directoryError: NodeJS.ErrnoException) => {
        if (directoryError.code === 'ENOENT') return [];
        throw directoryError;
      },
    );
    collision = entries.length > 0;
  }
  return {
    ok: true as const,
    action: 'company.adopt-preview',
    status: collision ? ('collision' as const) : ('preview' as const),
    organizationId,
    projectId,
    artifactId,
    revisionId,
    remoteContentDigest: revision.contentDigest,
    remoteByteLength: revision.byteLength,
    localPath: options.filePath,
    localCollision: collision,
    previewToken: collision ? null : previewToken,
    bundle,
    notice: collision
      ? 'The local target already differs. Resolve the collision before adopting; no file was changed.'
      : 'Review this exact company revision and target, then explicitly accept its preview token. Pull remains an inspection-only operation.',
  };
}

export async function adoptCompanyDiagramRevision(
  root: string,
  options: {
    apiUrl: string;
    projectId: string;
    artifactId: string;
    revisionId: string;
    filePath: string;
    accept: string;
  },
) {
  const preview = await previewCompanyDiagramAdoption(root, options);
  const previewToken = preview.previewToken;
  if (!previewToken || previewToken !== options.accept)
    return fail(
      'E_COMPANY_CONFLICT',
      'The selected revision, scope, or local target no longer matches the reviewed adoption preview.',
    );
  return withBindingLock(root, previewToken, async () => {
    const candidateLocalDigest = hash(JSON.stringify(preview.bundle, null, 2) + '\n');
    let prior: CompanyBinding | undefined;
    try {
      prior = (await loadState(root, 'bindings', previewToken)) as CompanyBinding;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      prior &&
      (prior.organizationId !== preview.organizationId ||
        prior.projectId !== preview.projectId ||
        prior.artifactId !== preview.artifactId ||
        prior.revisionId !== preview.revisionId ||
        prior.filePath !== options.filePath ||
        prior.contentDigest !== preview.remoteContentDigest ||
        expectedLocalDigest(prior) !== candidateLocalDigest)
    )
      return fail(
        'E_COMPANY_STATE',
        'Existing adoption binding conflicts with the reviewed revision.',
      );
    const adopted = await adoptDiagramBundle(
      root,
      options.filePath,
      preview.bundle as { diagramId: string; bundleDigest: string },
      preview.remoteContentDigest,
    );
    const localContent = await readArtifactFile(await safeFile(root, options.filePath));
    const binding: CompanyBinding = {
      schemaVersion: '1.0.0',
      id: previewToken,
      apiUrl: normalizeCompanyOrigin(options.apiUrl),
      organizationId: preview.organizationId,
      projectId: preview.projectId,
      artifactId: preview.artifactId,
      revisionId: preview.revisionId,
      filePath: options.filePath,
      title: (preview.bundle as { document: { title: string } }).document.title,
      kind: 'diagram',
      contentType: 'application/json',
      contentDigest: preview.remoteContentDigest,
      localContentDigest: hash(localContent),
      byteLength: preview.remoteByteLength,
      createdAt: new Date().toISOString(),
    };
    if (!prior) await saveState(root, 'bindings', binding.id, binding);
    return {
      ok: true as const,
      action: 'company.adopt',
      status: adopted.replayed ? 'already-adopted' : 'synchronized',
      bindingId: binding.id,
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      artifactId: binding.artifactId,
      revisionId: binding.revisionId,
      filePath: binding.filePath,
      remoteContentDigest: binding.contentDigest,
      localContentDigest: binding.localContentDigest,
    };
  });
}
export async function previewCompanyPull(
  root: string,
  bindingId: string,
  options: { revisionId?: string } = {},
) {
  return withBindingLock(root, bindingId, async () => {
    const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
    const localDigest = await boundLocalDigest(root, binding);
    const remoteHeadRevisionId = await boundRemoteHead(binding);
    const revision = await findRemoteRevision(
      binding,
      options.revisionId === undefined ? remoteHeadRevisionId : id(options.revisionId),
    );
    const content = await remoteRevisionContent(binding, revision);
    if ((await boundLocalDigest(root, binding)) !== localDigest)
      return fail(
        'E_COMPANY_CHANGED',
        'The local artifact changed during preview. Preview the remote revision again.',
      );
    const preview: CompanyPullPreview = {
      schemaVersion: '1.0.0',
      id: randomUUID(),
      bindingId,
      apiUrl: binding.apiUrl,
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      artifactId: binding.artifactId,
      filePath: binding.filePath,
      baseRevisionId: binding.revisionId,
      baseDigest: binding.contentDigest,
      localDigest,
      selection: options.revisionId === undefined ? 'latest' : 'revision',
      remoteHeadRevisionId,
      revision,
      createdAt: new Date().toISOString(),
    };
    await saveState(root, 'pull-previews', bindingId, preview);
    return {
      ok: true,
      action: 'company.pull-preview',
      status: 'preview',
      readOnly: true,
      contentTrust: 'untrusted',
      bindingId,
      preview,
      content,
      comparison: {
        localChanged:
          localDigest !== publicationSourceDigest(expectedLocalDigest(binding), binding),
        localMissing: localDigest === null,
        remoteChanged: remoteHeadRevisionId !== binding.revisionId,
      },
      notice:
        'Review these exact remote bytes, then invoke company pull without --preview to retrieve a private review copy. The repository file and accepted binding stay unchanged.',
    };
  });
}
export async function pullCompanyBinding(root: string, bindingId: string) {
  return withBindingLock(root, bindingId, async () => {
    const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
    let preview: CompanyPullPreview;
    try {
      preview = (await readState(root, 'pull-previews', bindingId)) as CompanyPullPreview;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return fail(
          'E_COMPANY_PREVIEW',
          'Review the remote revision with company pull --preview first.',
        );
      throw error;
    }
    if (
      !preview ||
      preview.schemaVersion !== '1.0.0' ||
      preview.bindingId !== bindingId ||
      preview.apiUrl !== binding.apiUrl ||
      preview.organizationId !== binding.organizationId ||
      preview.projectId !== binding.projectId ||
      preview.artifactId !== binding.artifactId ||
      preview.filePath !== binding.filePath ||
      preview.baseRevisionId !== binding.revisionId ||
      preview.baseDigest !== binding.contentDigest ||
      !['latest', 'revision'].includes(preview.selection) ||
      (preview.localDigest !== null && !isDigest(preview.localDigest)) ||
      typeof preview.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(preview.createdAt))
    )
      return fail(
        'E_COMPANY_STATE',
        'The pull preview no longer matches this publication binding. Create a fresh preview.',
      );
    id(preview.id);
    id(preview.remoteHeadRevisionId);
    const revision = await assertRemoteRevision(binding, preview.revision);
    if (preview.selection === 'latest' && revision.id !== preview.remoteHeadRevisionId)
      return fail(
        'E_COMPANY_STATE',
        'The selected revision does not match the previewed remote head.',
      );
    if ((await boundLocalDigest(root, binding)) !== preview.localDigest)
      return fail(
        'E_COMPANY_CHANGED',
        'The local artifact changed after preview. Review a fresh pull preview; no repository content was overwritten.',
      );
    const head = await boundRemoteHead(binding);
    if (preview.selection === 'latest' && head !== preview.remoteHeadRevisionId)
      return fail(
        'E_COMPANY_CONFLICT',
        'The remote head changed after preview. Review the latest revision again, or explicitly preview a historical revision.',
      );
    const content = await remoteRevisionContent(binding, revision);
    if ((await boundLocalDigest(root, binding)) !== preview.localDigest)
      return fail(
        'E_COMPANY_CHANGED',
        'The local artifact changed during retrieval. Review a fresh pull preview.',
      );
    const contentPath = path.join(
      await safeStateDirectory(root, 'remote-content'),
      `${preview.id}.txt`,
    );
    try {
      const info = await lstat(contentPath);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > MAX_BYTES ||
        hash(await readArtifactFile(contentPath)) !== revision.contentDigest
      )
        return fail(
          'E_COMPANY_STATE',
          'The previous review copy changed. Create a new pull preview to retrieve a separate copy.',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await replaceDurably(contentPath, content);
    }
    const receipt = {
      schemaVersion: '1.0.0',
      status: 'retrieved-for-review',
      bindingId,
      previewId: preview.id,
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      artifactId: binding.artifactId,
      revisionId: revision.id,
      contentDigest: revision.contentDigest,
      contentType: revision.contentType,
      byteLength: revision.byteLength,
      contentPath: path.relative(await realpath(root), contentPath),
      retrievedAt: new Date().toISOString(),
      contentTrust: 'untrusted',
      bindingAdvanced: false,
      remoteAcknowledgement: 'not-sent',
    };
    await saveState(root, 'pulls', preview.id, receipt);
    return {
      ok: true,
      action: 'company.pull',
      ...receipt,
      contentPath,
      notice:
        'Retrieved a private text copy for local inspection. Repository content and the accepted revision binding remain unchanged; no proposal or feedback was acknowledged.',
    };
  });
}

async function enterpriseRuntime() {
  const resolved = resolvePipelinePackage(true);
  if (!resolved) return fail('E_COMPANY_RUNTIME', 'The OpenPlanr workflow package is unavailable.');
  return await import(
    pathToFileURL(path.join(resolved.root, 'lib/protocol/enterprise-contracts.mjs')).href
  );
}
export async function previewCompanyProposal(root: string, bindingId: string, proposalId: string) {
  const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
  requireApplicableSource(binding);
  if (binding.contentType !== 'application/json')
    return fail(
      'E_COMPANY_AUTHORING',
      'Reviewed semantic application currently supports canonical JSON diagrams only. Download other proposals for manual review.',
    );
  const route = `/v1/projects/${id(binding.projectId)}/artifacts/${id(binding.artifactId)}`;
  id(proposalId);
  let proposal: Record<string, unknown> | undefined;
  let cursor: number | null = null;
  const seenCursors = new Set<number>();
  for (let page = 0; page < 200; page++) {
    const result: { proposals: Array<Record<string, unknown>>; nextCursor?: number | null } =
      await companyApi(
        binding.apiUrl,
        route + '/proposals' + (cursor === null ? '' : `?cursor=${cursor}`),
      );
    if (!Array.isArray(result.proposals))
      return fail('E_COMPANY_RESPONSE', 'The proposal list is invalid.');
    proposal = result.proposals.find((item) => item?.id === proposalId);
    if (proposal) break;
    if (result.nextCursor === null || result.nextCursor === undefined) break;
    if (
      !Number.isSafeInteger(result.nextCursor) ||
      result.nextCursor < 1 ||
      seenCursors.has(result.nextCursor)
    )
      return fail('E_COMPANY_RESPONSE', 'The proposal cursor is invalid.');
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  if (!proposal) return fail('E_COMPANY_PROPOSAL', 'Proposal not found in this artifact.');
  const runtime = await enterpriseRuntime();
  runtime.assertEnterpriseProposal(proposal);
  if (
    proposal.organizationId !== binding.organizationId ||
    proposal.artifactId !== binding.artifactId ||
    proposal.projectId !== binding.projectId ||
    proposal.baseRevisionId !== binding.revisionId ||
    !['proposed', 'accepted'].includes(String(proposal.status))
  )
    return fail('E_COMPANY_CONFLICT', 'This proposal is not applicable to the bound revision.');
  const status = await companyBindingStatus(root, bindingId);
  if (status.status !== 'synchronized')
    return fail(
      'E_COMPANY_CONFLICT',
      'Local or remote content changed. Compare revisions before applying.',
    );
  const content = await readArtifactFile(await safeFile(root, binding.filePath));
  if (hash(content) !== expectedLocalDigest(binding))
    return fail(
      'E_COMPANY_CONFLICT',
      'The local file changed while preparing the preview. Compare revisions before applying.',
    );
  const original = JSON.parse(content);
  if (original?.kind === 'diagram-authoring-bundle') {
    await assertCompleteDiagramBundle(original, binding.filePath);
    const replacement =
      Array.isArray(proposal.operations) && proposal.operations.length === 1
        ? (proposal.operations[0] as { op?: string; content?: unknown })
        : null;
    if (replacement?.op !== 'replace-document')
      return fail(
        'E_COMPANY_AUTHORING',
        'Complete diagram bundles require one reviewed successor bundle proposal.',
      );
    const successor = replacement.content as {
      diagramId: string;
      originalSource?: { sourceDigest: string } | null;
      sourceMap?: unknown;
    };
    await assertCompleteDiagramBundle(successor, binding.filePath);
    const runtime = await diagramAuthoringRuntime();
    const diff = runtime.diffDiagramBundles(original, successor);
    if (!diff.ok)
      return fail(
        'E_COMPANY_AUTHORING',
        'The successor bundle could not be compared with its exact base.',
      );
    const baseLayout = await loadLayout(root, bindingId);
    if (Object.keys(baseLayout).length)
      return fail(
        'E_COMPANY_AUTHORING',
        'An authored bundle cannot carry a separate legacy layout.',
      );
    const rendered = JSON.stringify(successor, null, 2) + '\n';
    if (Buffer.byteLength(rendered) > MAX_BYTES)
      return fail('E_COMPANY_SIZE', 'The proposed bundle exceeds the 1 MiB company limit.');
    checkContent(rendered);
    return {
      ok: true,
      action: 'company.proposal-preview',
      bindingId,
      proposalId,
      summary: proposal.summary,
      filePath: binding.filePath,
      baseRevisionId: binding.revisionId,
      baseDigest: expectedLocalDigest(binding),
      baseLayoutDigest: layoutDigest(baseLayout),
      document: successor,
      layout: baseLayout,
      semanticChanged: hash(rendered) !== expectedLocalDigest(binding),
      layoutChanged: false,
      changes: {
        semantic: diff.semantic,
        presentation: diff.presentation,
        source: {
          originalBytesChanged:
            original.originalSource?.sourceDigest !== successor.originalSource?.sourceDigest,
          correspondenceChanged:
            hash(JSON.stringify(original.sourceMap)) !== hash(JSON.stringify(successor.sourceMap)),
        },
      },
      before: original,
    };
  }
  if (original.kind !== 'planr-diagram')
    return fail(
      'E_COMPANY_AUTHORING',
      'This document type does not yet support validated semantic application.',
    );
  const baseLayout = await loadLayout(root, bindingId);
  const transformed = runtime.applyEnterpriseOperations(original, proposal, { layout: baseLayout });
  if (transformed.layoutChanged)
    return fail(
      'E_COMPANY_AUTHORING',
      'Layout proposals cannot be applied until the local renderer and publication path consume stored layout state.',
    );
  const pipeline = resolvePipelinePackage(true);
  if (!pipeline) return fail('E_COMPANY_RUNTIME', 'The OpenPlanr workflow package is unavailable.');
  const canonical = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/protocol/canonical-json.mjs')).href
  );
  const diagram = await import(
    pathToFileURL(path.join(pipeline.root, 'lib/artifact/diagram/index.mjs')).href
  );
  if (transformed.document.diagramId !== original.diagramId)
    return fail('E_COMPANY_SCOPE', 'A proposal cannot replace the bound diagram identity.');
  const document = canonical.withDocumentDigest(transformed.document);
  diagram.assertDiagramDocument(document);
  const rendered = JSON.stringify(document, null, 2) + '\n';
  if (Buffer.byteLength(rendered) > MAX_BYTES)
    return fail('E_COMPANY_SIZE', 'The proposed document exceeds the 1 MiB company limit.');
  checkContent(rendered);
  return {
    ok: true,
    action: 'company.proposal-preview',
    bindingId,
    proposalId,
    summary: proposal.summary,
    filePath: binding.filePath,
    baseRevisionId: binding.revisionId,
    baseDigest: expectedLocalDigest(binding),
    baseLayoutDigest: layoutDigest(baseLayout),
    document,
    layout: transformed.layout ?? {},
    semanticChanged: transformed.semanticChanged,
    layoutChanged: transformed.layoutChanged,
    changes: transformed.changes,
    before: original,
  };
}
async function requireNoPendingApplication(root: string, bindingId: string) {
  const directory = await safeStateDirectory(root, 'pending-applications');
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const proposalId = id(name.slice(0, -5));
    const pending = (await readState(
      root,
      'pending-applications',
      proposalId,
    )) as Partial<PendingApplication>;
    if (pending?.bindingId !== bindingId) continue;
    // A completed receipt can outlive best-effort journal cleanup.
    let receipt:
      | { bindingId?: string; proposalId?: string; status?: string; resultDigest?: string }
      | undefined;
    try {
      receipt = (await readState(root, 'applications', proposalId)) as typeof receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      receipt?.bindingId === bindingId &&
      receipt.proposalId === proposalId &&
      receipt.status === 'applied-locally' &&
      receipt.resultDigest === pending.resultDigest
    )
      continue;
    return fail(
      'E_COMPANY_RECOVERY',
      `Finish pending recovery with company apply ${bindingId} ${proposalId} before starting another operation on this artifact.`,
    );
  }
}
async function resumePendingApplication(
  root: string,
  binding: CompanyBinding,
  pending: PendingApplication,
) {
  if (
    !pending ||
    pending.schemaVersion !== '1.0.0' ||
    pending.status !== 'pending-local-application' ||
    pending.bindingId !== binding.id ||
    pending.filePath !== binding.filePath ||
    pending.apiUrl !== binding.apiUrl ||
    pending.organizationId !== binding.organizationId ||
    pending.projectId !== binding.projectId ||
    pending.artifactId !== binding.artifactId ||
    pending.baseRevisionId !== binding.revisionId ||
    pending.baseDigest !== expectedLocalDigest(binding) ||
    !isDigest(pending.baseDigest) ||
    !isDigest(pending.resultDigest) ||
    !isDigest(pending.baseLayoutDigest) ||
    !isDigest(pending.resultLayoutDigest) ||
    typeof pending.semanticChanged !== 'boolean' ||
    typeof pending.layoutChanged !== 'boolean' ||
    typeof pending.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(pending.preparedAt))
  )
    return fail(
      'E_COMPANY_STATE',
      'The pending application does not match this publication binding.',
    );
  id(pending.proposalId);
  id(pending.backupId);
  if (layoutDigest(pending.layout) !== pending.resultLayoutDigest)
    return fail('E_COMPANY_STATE', 'The pending layout digest does not match its contents.');
  const staged = await readStoredContent(root, 'application-content', pending.proposalId);
  const backup = await readStoredContent(root, 'backups', pending.backupId);
  if (
    hash(staged) !== pending.resultDigest ||
    hash(backup) !== pending.baseDigest ||
    pending.semanticChanged !== (pending.baseDigest !== pending.resultDigest) ||
    pending.layoutChanged !== (pending.baseLayoutDigest !== pending.resultLayoutDigest)
  )
    return fail('E_COMPANY_STATE', 'Pending application content failed its digest check.');
  const original = JSON.parse(backup);
  const authored = original?.kind === 'diagram-authoring-bundle';
  if (authored) {
    await assertCompleteDiagramBundle(original, binding.filePath);
    const successor = JSON.parse(staged);
    await assertCompleteDiagramBundle(successor, binding.filePath);
    if (pending.layoutChanged)
      return fail('E_COMPANY_AUTHORING', 'A complete bundle cannot apply a separate layout.');
    await commitReviewedDiagramSuccessor(
      root,
      binding.filePath,
      successor,
      `company-${hash(`${binding.id}:${pending.proposalId}`).slice(0, 40)}`,
      {
        byteDigest: `sha256:${pending.baseDigest}`,
        basis: {
          bundleDigest: original.bundleDigest,
          semanticDigest: original.document.documentDigest,
          presentationDigest: original.presentation.presentationDigest,
        },
      },
    );
  }
  const inspect = async () => {
    const sourceDigest = hash(await readArtifactFile(await safeFile(root, binding.filePath)));
    const currentLayoutDigest = layoutDigest(await loadLayout(root, binding.id));
    if (
      ![pending.baseDigest, pending.resultDigest].includes(sourceDigest) ||
      ![pending.baseLayoutDigest, pending.resultLayoutDigest].includes(currentLayoutDigest) ||
      (pending.semanticChanged &&
        pending.layoutChanged &&
        sourceDigest === pending.baseDigest &&
        currentLayoutDigest === pending.resultLayoutDigest)
    )
      return fail(
        'E_COMPANY_CONFLICT',
        'The file or layout changed after this application was prepared. Pending recovery and the backup were preserved; no unrelated edits were overwritten.',
      );
    return { sourceDigest, currentLayoutDigest };
  };
  let state = await inspect();
  if (state.sourceDigest !== pending.resultDigest) {
    if (authored)
      return fail(
        'E_COMPANY_CONFLICT',
        'The reviewed complete bundle was not committed by the authoring store.',
      );
    const target = await safeFile(root, binding.filePath);
    await replaceDurably(target, staged, (await lstat(target)).mode & 0o777, async () => {
      const latest = await inspect();
      if (latest.sourceDigest !== pending.baseDigest)
        return fail(
          'E_COMPANY_CONFLICT',
          'The source changed during recovery. Retry after inspecting its pending application.',
        );
    });
  }
  state = await inspect();
  if (state.currentLayoutDigest !== pending.resultLayoutDigest)
    await saveState(root, 'layouts', binding.id, {
      schemaVersion: '1.0.0',
      bindingId: binding.id,
      layout: pending.layout,
    });
  state = await inspect();
  if (
    state.sourceDigest !== pending.resultDigest ||
    state.currentLayoutDigest !== pending.resultLayoutDigest
  )
    return fail(
      'E_COMPANY_CONFLICT',
      'The application result changed before it could be recorded. Its pending journal was preserved.',
    );
  const backupPath = await statePath(root, 'backups', pending.backupId);
  await saveState(root, 'applications', pending.proposalId, {
    schemaVersion: '1.0.0',
    bindingId: binding.id,
    proposalId: pending.proposalId,
    baseRevisionId: pending.baseRevisionId,
    filePath: binding.filePath,
    backupPath: path.relative(await realpath(root), backupPath),
    appliedAt: new Date().toISOString(),
    status: 'applied-locally',
    remoteAcknowledgement: 'pending',
    resultDigest: pending.resultDigest,
    resultLayoutDigest: pending.resultLayoutDigest,
    layout: pending.layout,
  });
  // The durable receipt is authoritative after this point. Cleanup is best effort.
  await unlink(await statePath(root, 'pending-applications', pending.proposalId)).catch(() => {});
  await unlink(await statePath(root, 'application-content', pending.proposalId)).catch(() => {});
  return {
    ok: true,
    action: 'company.apply',
    status: 'applied-locally',
    filePath: binding.filePath,
    proposalId: pending.proposalId,
    backupPath,
    semanticChanged: pending.semanticChanged,
    layoutChanged: pending.layoutChanged,
    notice:
      'Review and commit the local change. Use company push --preview to review its publication. Proposal acknowledgement remains pending; local application does not resolve hosted feedback.',
  };
}
export async function applyCompanyProposal(root: string, bindingId: string, proposalId: string) {
  id(proposalId);
  return withBindingLock(root, bindingId, async () => {
    const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
    requireApplicableSource(binding);
    let applied:
      | {
          schemaVersion: string;
          bindingId: string;
          proposalId: string;
          filePath: string;
          resultDigest: string;
          resultLayoutDigest?: string;
          backupPath: string;
        }
      | undefined;
    try {
      applied = (await readState(root, 'applications', proposalId)) as typeof applied;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (applied) {
      if (
        applied.schemaVersion !== '1.0.0' ||
        applied.bindingId !== bindingId ||
        applied.proposalId !== proposalId ||
        !isDigest(applied.resultDigest) ||
        (applied.resultLayoutDigest !== undefined && !isDigest(applied.resultLayoutDigest))
      )
        return fail('E_COMPANY_STATE', 'Invalid previous proposal application.');
      if (
        applied.filePath !== binding.filePath ||
        hash(await readArtifactFile(await safeFile(root, binding.filePath))) !==
          applied.resultDigest ||
        (applied.resultLayoutDigest !== undefined &&
          layoutDigest(await loadLayout(root, bindingId)) !== applied.resultLayoutDigest)
      )
        return fail(
          'E_COMPANY_CONFLICT',
          'This proposal was already applied and the local result has since changed. Review its application record before continuing.',
        );
      return {
        ok: true,
        action: 'company.apply',
        status: 'already-applied-locally',
        filePath: binding.filePath,
        proposalId,
        backupPath: applied.backupPath,
        notice:
          'This proposal was already applied locally. No additional repository changes or remote acknowledgements were made.',
      };
    }
    let pending: PendingApplication | undefined;
    try {
      pending = (await readState(root, 'pending-applications', proposalId)) as PendingApplication;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (pending) {
      if (pending.proposalId !== proposalId)
        return fail(
          'E_COMPANY_STATE',
          'The pending proposal identity does not match this request.',
        );
      return resumePendingApplication(root, binding, pending);
    }
    await requireNoPendingApplication(root, bindingId);
    const preview = await previewCompanyProposal(root, bindingId, proposalId);
    const current = await readArtifactFile(await safeFile(root, preview.filePath));
    if (hash(current) !== preview.baseDigest)
      return fail(
        'E_COMPANY_CONFLICT',
        'The local file changed while preparing the proposal. Nothing was applied.',
      );
    const baseLayout = await loadLayout(root, bindingId);
    if (layoutDigest(baseLayout) !== preview.baseLayoutDigest)
      return fail(
        'E_COMPANY_CONFLICT',
        'The layout changed while preparing the proposal. Nothing was applied.',
      );
    const staged = preview.semanticChanged
      ? JSON.stringify(preview.document, null, 2) + '\n'
      : current;
    pending = {
      schemaVersion: '1.0.0',
      status: 'pending-local-application',
      bindingId,
      proposalId,
      apiUrl: binding.apiUrl,
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      artifactId: binding.artifactId,
      filePath: binding.filePath,
      baseRevisionId: binding.revisionId,
      baseDigest: preview.baseDigest,
      resultDigest: hash(staged),
      baseLayoutDigest: layoutDigest(baseLayout),
      resultLayoutDigest: layoutDigest(preview.layout),
      layout: preview.layout,
      backupId: randomUUID(),
      preparedAt: new Date().toISOString(),
      semanticChanged: hash(staged) !== preview.baseDigest,
      layoutChanged: layoutDigest(baseLayout) !== layoutDigest(preview.layout),
    };
    await replaceDurably(await statePath(root, 'backups', pending.backupId), current);
    await replaceDurably(await statePath(root, 'application-content', proposalId), staged);
    // No source or layout changes occur before all recovery inputs and this journal are durable.
    await saveState(root, 'pending-applications', proposalId, pending);
    return resumePendingApplication(root, binding, pending);
  });
}

export async function previewCompanyPush(root: string, bindingId: string) {
  return withBindingLock(root, bindingId, async () => {
    await requireNoPendingApplication(root, bindingId);
    const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
    const status = await companyBindingStatus(root, bindingId);
    if (status.status === 'conflicted' || status.status === 'remote-changes')
      return fail(
        'E_COMPANY_CONFLICT',
        'The remote revision changed. Compare revisions before creating an update preview; retry an existing publication without --preview if its response was interrupted.',
      );
    const prepared = await prepareCompanyContent(root, binding);
    const { content, warnings: _warnings, ...source } = prepared;
    checkContent(content);
    if (Buffer.byteLength(content) > MAX_BYTES)
      return fail('E_COMPANY_SIZE', 'Artifact exceeds the 1 MiB publication limit.');
    const preview: CompanyPushPreview = {
      ...binding,
      ...source,
      contentDigest: hash(content),
      localContentDigest: hash(content),
      byteLength: Buffer.byteLength(content),
      createdAt: new Date().toISOString(),
      operationId: randomUUID(),
    };
    await saveState(root, 'push-previews', bindingId, preview);
    return {
      ok: true,
      action: 'company.push-preview',
      status:
        preview.contentDigest === expectedLocalDigest(binding) &&
        sameSourceManifest(binding, prepared)
          ? 'unchanged'
          : 'preview',
      bindingId,
      baseRevisionId: binding.revisionId,
      preview: publicPreview(preview),
      selectedFiles: preview.sourceFiles ?? [binding.filePath],
      content,
      ...(prepared.warnings?.length ? { warnings: prepared.warnings } : {}),
      notice:
        preview.sourceType === 'design-document'
          ? 'Only the listed design document and referenced files will be updated. Review this exact scope, then invoke company push without --preview.'
          : 'Only this bound file will be updated. Review its content, then invoke company push without --preview.',
    };
  });
}

export async function pushCompanyBinding(root: string, bindingId: string) {
  return withBindingLock(root, bindingId, async () => {
    await requireNoPendingApplication(root, bindingId);
    const binding = (await loadState(root, 'bindings', bindingId)) as CompanyBinding;
    let preview: CompanyPushPreview;
    try {
      preview = (await loadState(root, 'push-previews', bindingId)) as CompanyPushPreview;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return fail('E_COMPANY_PREVIEW', 'Review this update with company push --preview first.');
      throw error;
    }
    if (
      preview.filePath !== binding.filePath ||
      preview.apiUrl !== binding.apiUrl ||
      preview.projectId !== binding.projectId ||
      preview.organizationId !== binding.organizationId ||
      preview.artifactId !== binding.artifactId ||
      preview.contentType !== binding.contentType ||
      preview.sourceType !== binding.sourceType
    )
      return fail('E_COMPANY_SCOPE', 'The update preview does not match its publication binding.');
    const prepared = await prepareCompanyContent(root, binding);
    const { content } = prepared;
    if (hash(content) !== preview.contentDigest || !sameSourceManifest(preview, prepared))
      return fail(
        'E_COMPANY_CHANGED',
        'The bound file or a referenced design source changed after preview. Review a new update preview before sharing.',
      );
    checkContent(content);
    if (
      preview.publishedRevisionId === binding.revisionId &&
      preview.contentDigest === binding.contentDigest
    )
      return {
        ok: true,
        action: 'company.push',
        status: 'already-published',
        bindingId,
        artifactId: binding.artifactId,
        revisionId: binding.revisionId,
        synchronization: 'not-checked',
        notice:
          'This update completed earlier. Its receipt was preserved; run company status to check current local and remote revisions.',
      };
    if (preview.revisionId !== binding.revisionId)
      return fail(
        'E_COMPANY_CONFLICT',
        'The binding changed after this preview. Review a new update preview.',
      );
    if (preview.contentDigest === expectedLocalDigest(binding)) {
      // A reviewed source-only change (for example JSON whitespace) needs no new hosted
      // revision, but its exact local source manifest becomes the accepted baseline.
      await saveState(root, 'bindings', bindingId, {
        ...binding,
        sourceFiles: preview.sourceFiles,
        sourceDigests: preview.sourceDigests,
      });
      return {
        ok: true,
        action: 'company.push',
        status: 'unchanged',
        bindingId,
        artifactId: binding.artifactId,
        revisionId: binding.revisionId,
      };
    }
    const replayed = Boolean(preview.publishedRevisionId);
    if (!preview.publishedRevisionId) {
      const result = await companyApi<{
        revision: {
          id: string;
          organizationId: string;
          projectId: string;
          artifactId: string;
          parentRevisionId: string;
          contentDigest: string;
        };
      }>(
        binding.apiUrl,
        `/v1/projects/${id(binding.projectId)}/artifacts/${id(binding.artifactId)}/revisions`,
        {
          method: 'POST',
          body: { baseRevisionId: preview.revisionId, content, contentType: binding.contentType },
          idempotencyKey: preview.operationId,
        },
      );
      const revision = result?.revision;
      if (
        !revision ||
        revision.organizationId !== binding.organizationId ||
        revision.projectId !== binding.projectId ||
        revision.artifactId !== binding.artifactId ||
        revision.parentRevisionId !== preview.revisionId ||
        revision.contentDigest !== preview.contentDigest ||
        revision.id === preview.revisionId
      )
        return fail(
          'E_COMPANY_RESPONSE',
          'The returned revision does not match the reviewed update.',
        );
      preview.publishedRevisionId = id(revision.id);
      await saveState(root, 'push-previews', bindingId, preview);
    }
    const { operationId: _operationId, publishedRevisionId, ...published } = preview;
    await saveState(root, 'bindings', bindingId, { ...published, revisionId: publishedRevisionId });
    return {
      ok: true,
      action: 'company.push',
      status: replayed ? 'already-published' : 'synchronized',
      bindingId,
      artifactId: binding.artifactId,
      revisionId: publishedRevisionId,
      ...(replayed ? { synchronization: 'not-checked' } : {}),
      notice: replayed
        ? 'This update completed earlier. Its receipt and local binding were recovered; run company status to check current local and remote revisions. Proposal acknowledgement remains separate.'
        : 'The reviewed artifact revision is published. Proposal acknowledgement and feedback resolution remain separate actions.',
    };
  });
}
