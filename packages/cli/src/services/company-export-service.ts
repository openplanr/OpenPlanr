import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CompanyResourceManifest } from 'planr-pipeline/resource-contracts';
import { LARGE_OBJECT_LIMITS } from '../../lib/resource-limits.mjs';
import {
  assertCompanyResourceManifest,
  assertRemoteRevision,
  type CompanyRemoteRevision,
  CompanySyncError,
  companyResourceContracts,
  companyResourceRuntime,
  companyResponse,
  id,
  MAX_RESPONSE_BYTES,
  normalizeCompanyOrigin,
  readCompanyBody,
  readCompanyBytes,
  readCompanyRevisionContent,
} from './company-sync-service.js';

// Review pages hold ten complete threads, including up to 100 replies each.
const MAX_REVIEW_PAGE_BYTES = 64 * 1024 * 1024;
type RecordData = Record<string, unknown>;
interface ExportFile {
  path: string;
  byteLength: number;
  sha256: string;
}
interface ExportScope {
  organizationId: string;
  projectId: string;
  artifactId: string;
}
export interface CompanyOrganizationExport {
  schemaVersion: '1.0.0';
  complete: boolean;
  apiUrl: string | null;
  generatedAt: string;
  summary: {
    projects: number;
    artifacts: number;
    revisions: number;
    files: number;
    bytes: number;
    notExported: number;
  };
  files: ExportFile[];
  notExported: Array<{ project: RecordData; reason: string }>;
  reviews: Array<
    ExportScope & { revisionId: string; path: string; source: 'export' | 'paginated' }
  >;
  notices: string[];
  error?: string;
}
class ExportRequestError extends CompanySyncError {
  constructor(
    public readonly status: number,
    public readonly apiCode: string | undefined,
    options?: ErrorOptions,
  ) {
    super(
      'E_COMPANY_REQUEST',
      `Company request failed (${status}${apiCode ? ` ${apiCode}` : ''}).`,
      options,
    );
  }
}
function fail(message: string, cause?: unknown): never {
  throw new CompanySyncError(
    'E_COMPANY_EXPORT',
    message,
    cause === undefined ? undefined : { cause },
  );
}
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const serialize = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function record(value: unknown): RecordData {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('Invalid company response object.');
  return value as RecordData;
}
function parse(content: string): RecordData {
  try {
    return record(JSON.parse(content));
  } catch (cause) {
    return fail('Invalid company JSON response.', cause);
  }
}
function filesystemCode(error: unknown): string {
  const codes = [
    'EACCES',
    'EPERM',
    'ENOENT',
    'ENOTDIR',
    'EEXIST',
    'ENOSPC',
    'EIO',
    'EROFS',
    'EMFILE',
  ];
  return error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
    ? error.code
    : 'filesystem operation failed';
}
async function prepareDirectory(directory: string) {
  if (!directory.trim()) fail('Supply a non-existent or empty output directory.');
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail('The output must be a directory, not a symbolic link.');
    if ((await readdir(directory)).length) fail('The output directory must be empty.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
}

/** Exports all readable company revisions and records inaccessible project inventory. */
export async function exportCompanyOrganization(
  apiUrl: string,
  outDir: string,
): Promise<CompanyOrganizationExport> {
  const directory = path.resolve(outDir);
  try {
    await prepareDirectory(outDir);
  } catch (error) {
    if (error instanceof CompanySyncError) throw error;
    fail(`Cannot prepare the output directory (${filesystemCode(error)}).`);
  }
  const manifest: CompanyOrganizationExport = {
    schemaVersion: '1.0.0',
    complete: false,
    apiUrl: null,
    generatedAt: new Date().toISOString(),
    summary: { projects: 0, artifacts: 0, revisions: 0, files: 0, bytes: 0, notExported: 0 },
    files: [],
    notExported: [],
    reviews: [],
    notices: [],
  };
  let item = 'organization';
  let origin: string;
  async function request(route: string): Promise<Response> {
    const response = await companyResponse(origin, route, {
      allowErrorResponse: true,
    });
    if (response.ok) return response;
    let error: RecordData;
    try {
      const { content } = await readCompanyBody(response, MAX_RESPONSE_BYTES);
      error = record(parse(content).error);
    } catch (cause) {
      throw new ExportRequestError(response.status, undefined, { cause });
    }
    const code =
      typeof error.code === 'string' &&
      error.code.trim() === error.code &&
      /^E_[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : undefined;
    throw new ExportRequestError(response.status, code);
  }
  async function readJson(route: string, maximum = MAX_RESPONSE_BYTES): Promise<RecordData> {
    const { content } = await readCompanyBody(await request(route), maximum);
    const value = parse(content);
    return value;
  }
  async function write(relative: string, bytes: Uint8Array) {
    const parts = relative.split('/');
    let current = directory;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        fail('Export directories must not contain symbolic links.');
    }
    const target = path.join(directory, relative);
    try {
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        try {
          await unlink(target);
        } catch (cleanup) {
          if (!(cleanup instanceof Error && 'code' in cleanup && cleanup.code === 'ENOENT'))
            fail(
              `Payload write failed (${filesystemCode(error)}); partial file cleanup failed (${filesystemCode(cleanup)}).`,
            );
        }
      }
      throw error;
    }
    manifest.files.push({ path: relative, byteLength: bytes.byteLength, sha256: hash(bytes) });
    manifest.summary.files++;
    manifest.summary.bytes += bytes.byteLength;
  }
  async function* pages(route: string, key: string, size = 50): AsyncGenerator<RecordData> {
    let cursor = 0;
    const seen = new Set<string>();
    for (let page = 0; page < 2000; page++) {
      const result = await readJson(
        `${route}?cursor=${cursor}`,
        key === 'threads' ? MAX_REVIEW_PAGE_BYTES : MAX_RESPONSE_BYTES,
      );
      const rows = result[key];
      if (!Array.isArray(rows) || rows.length > size) fail(`Invalid ${key} page.`);
      for (const row of rows) {
        const value = record(row);
        const identity = id(value.id);
        if (seen.has(identity)) fail(`Duplicate ${key} identifier ${identity}.`);
        seen.add(identity);
        yield value;
      }
      if (result.nextCursor === null) return;
      const next = result.nextCursor;
      if (
        typeof next !== 'number' ||
        !Number.isSafeInteger(next) ||
        next <= cursor ||
        next > 1000000
      )
        fail(`Invalid ${key} cursor.`);
      cursor = next;
    }
    fail(`${key} pagination exceeded 2000 pages; export incomplete.`);
  }
  async function* projectCatalog(): AsyncGenerator<RecordData> {
    const route = '/v1/project-catalog?status=all&pageSize=100';
    let cursor: string | undefined;
    let organizationId: string | undefined;
    const seenProjects = new Set<string>();
    const seenCursors = new Set<string>();
    for (let page = 0; page < 2000; page++) {
      const result = await readJson(route + (cursor === undefined ? '' : `&cursor=${cursor}`));
      if (
        result.kind !== 'openplanr-enterprise-project-page' ||
        result.schemaVersion !== '1.0.0' ||
        !Array.isArray(result.items) ||
        result.items.length > 100
      )
        fail('Invalid project catalog page.');
      const query = record(result.query);
      const filter = record(query.filter);
      if (query.scope !== 'projects' || filter.status !== 'all' || filter.search !== '')
        fail('The project catalog query does not match the requested scope.');
      const organization = id(query.organizationId);
      id(query.actorId);
      if (organizationId && organizationId !== organization)
        fail('Catalog pages belong to different organizations.');
      organizationId = organization;
      for (const value of result.items) {
        const project = record(value);
        const projectId = id(project.projectId);
        if (id(project.organizationId) !== organizationId)
          fail('Catalog projects belong to different organizations.');
        if (seenProjects.has(projectId)) fail(`Duplicate project ${projectId}.`);
        if (
          typeof project.status !== 'string' ||
          !['active', 'archiving', 'archived', 'restoring'].includes(project.status)
        )
          fail(`Invalid project status for project ${projectId}.`);
        seenProjects.add(projectId);
        yield project;
      }
      if (result.nextCursor === null) return;
      const next = result.nextCursor;
      if (
        typeof next !== 'string' ||
        next.trim() !== next ||
        !/^[A-Za-z0-9_-]{1,2048}$/.test(next) ||
        seenCursors.has(next)
      )
        fail('Invalid or repeated project catalog cursor.');
      seenCursors.add(next);
      cursor = next;
    }
    fail('Project catalog pagination exceeded 2000 pages; export incomplete.');
  }
  function assertScope(value: RecordData, scope: ExportScope) {
    if (
      value.organizationId !== scope.organizationId ||
      value.projectId !== scope.projectId ||
      value.artifactId !== scope.artifactId
    )
      fail('The response belongs to a different project or artifact.');
  }
  async function exportReviews(
    scope: ExportScope,
    revision: CompanyRemoteRevision,
    route: string,
    folder: string,
  ) {
    let reviews: RecordData;
    let source: 'export' | 'paginated' = 'export';
    try {
      reviews = await readJson(
        `${route}/export?format=json&revisionId=${revision.id}`,
        MAX_REVIEW_PAGE_BYTES,
      );
    } catch (error) {
      const limited =
        error instanceof ExportRequestError &&
        error.status === 413 &&
        error.apiCode === 'E_EXPORT_LIMIT';
      if (!limited) throw error;
      source = 'paginated';
      const threads: RecordData[] = [];
      for await (const thread of pages(`${route}/reviews`, 'threads', 10)) {
        assertScope(thread, scope);
        if (id(record(thread.anchor).revisionId) === revision.id) threads.push(thread);
      }
      reviews = {
        ...scope,
        revisionId: revision.id,
        generatedAt: new Date().toISOString(),
        authority: 'feedback-only',
        contentTrust: 'untrusted',
        threads,
      };
    }
    assertScope(reviews, scope);
    if (reviews.revisionId !== revision.id || !Array.isArray(reviews.threads))
      fail('The review export does not match the selected revision.');
    const seen = new Set<string>();
    for (const value of reviews.threads) {
      const thread = record(value);
      assertScope(thread, scope);
      const identity = id(thread.id);
      if (record(thread.anchor).revisionId !== revision.id || seen.has(identity))
        fail('The review export has invalid or duplicate revision anchors.');
      seen.add(identity);
    }
    const relative = `${folder}/reviews.json`;
    await write(relative, serialize(reviews));
    manifest.reviews.push({ ...scope, revisionId: revision.id, path: relative, source });
  }
  async function exportContent(
    scope: ExportScope,
    revision: CompanyRemoteRevision,
    route: string,
    folder: string,
  ) {
    if (revision.contentReference?.transport !== 'resources-v2') {
      const content = await readCompanyRevisionContent(
        await request(`${route}/content?revisionId=${revision.id}`),
        revision,
      );
      await write(`${folder}/content.txt`, Buffer.from(content));
      return;
    }
    const resourceRoute = `${route}/revisions/${revision.id}`;
    const resourceManifest = (await readJson(
      `${resourceRoute}/manifest`,
    )) as unknown as CompanyResourceManifest;
    await assertCompanyResourceManifest(scope, revision, resourceManifest);
    const chunks = new Map<number, Uint8Array>();
    for (const chunk of resourceManifest.chunks) {
      const bytes = await readCompanyBytes(
        await request(`${resourceRoute}/chunks/${chunk.index}`),
        LARGE_OBJECT_LIMITS.chunkBytes,
      );
      if (bytes.byteLength !== chunk.byteLength || hash(bytes) !== chunk.sha256)
        fail(`Resource chunk ${chunk.index} digest or length mismatch.`);
      chunks.set(chunk.index, bytes);
    }
    const { openCompanyResourcePack } = await companyResourceRuntime();
    const { canonicalizeJson } = await companyResourceContracts();
    let content: string;
    try {
      const opened = await openCompanyResourcePack(resourceManifest, {
        fetchChunk: async (index: number) => {
          const bytes = chunks.get(index);
          if (!bytes) fail('The resource manifest references an unavailable chunk.');
          return bytes;
        },
      });
      try {
        content = canonicalizeJson(await opened.loadBundle());
      } finally {
        opened.dispose();
      }
    } catch (cause) {
      fail('Resource catalog, chunk or reassembled content failed integrity verification.', cause);
    }
    for (const [index, bytes] of chunks)
      await write(`${folder}/chunks/${id(String(index))}.bin`, bytes);
    await write(`${folder}/resource-manifest.json`, serialize(resourceManifest));
    await write(`${folder}/content.json`, Buffer.from(content));
  }
  async function exportProject(project: RecordData) {
    const projectId = id(project.projectId);
    item = `project ${projectId}`;
    const organizationId = id(project.organizationId);
    await write(`projects/${projectId}/project.json`, serialize(project));
    const route = `/v1/projects/${projectId}/artifacts`;
    for await (const artifact of pages(route, 'artifacts')) {
      const artifactId = id(artifact.id);
      item = `project ${projectId}, artifact ${artifactId}`;
      if (artifact.organizationId !== organizationId || artifact.projectId !== projectId)
        fail('The artifact belongs to a different project.');
      const scope = { organizationId, projectId, artifactId };
      const folder = `projects/${projectId}/artifacts/${artifactId}`;
      await write(`${folder}/artifact.json`, serialize(artifact));
      for await (const value of pages(`${route}/${artifactId}/revisions`, 'revisions')) {
        const revisionId = id(value.id);
        item = `project ${projectId}, artifact ${artifactId}, revision ${revisionId}`;
        const revision = await assertRemoteRevision(scope, value);
        const revisionFolder = `${folder}/revisions/${revisionId}`;
        await write(`${revisionFolder}/revision.json`, serialize(revision));
        await exportContent(scope, revision, `${route}/${artifactId}`, revisionFolder);
        await exportReviews(scope, revision, `${route}/${artifactId}`, revisionFolder);
        manifest.summary.revisions++;
        item = `project ${projectId}, artifact ${artifactId}`;
      }
      manifest.summary.artifacts++;
      item = `project ${projectId}`;
    }
    manifest.summary.projects++;
  }
  let failure: unknown;
  try {
    origin = normalizeCompanyOrigin(apiUrl);
    manifest.apiUrl = origin;
    item = 'project catalog';
    const projects: RecordData[] = [];
    const knownProjects = new Set<string>();
    const archived: string[] = [];
    for await (const project of projectCatalog()) {
      const projectId = id(project.projectId);
      knownProjects.add(projectId);
      if (project.status === 'active') projects.push(project);
      else {
        archived.push(projectId);
        manifest.notExported.push({ project, reason: 'archived; restore first' });
      }
    }
    item = 'admin projects';
    try {
      for await (const project of pages('/v1/admin/projects', 'projects')) {
        if (!knownProjects.has(id(project.id)))
          manifest.notExported.push({ project, reason: 'no readable project role' });
      }
    } catch (error) {
      if (
        !(
          error instanceof ExportRequestError &&
          error.status === 403 &&
          error.apiCode !== undefined &&
          ['E_ROLE', 'E_MFA_REQUIRED', 'E_REVERIFICATION_REQUIRED'].includes(error.apiCode)
        )
      )
        throw error;
      manifest.notices.push(
        'admin listing unavailable: needs an MFA-verified browser session; projects without a role not checked',
      );
    }
    for (const project of projects) await exportProject(project);
    item = 'organization';
    if (archived.length)
      fail(archived.map((projectId) => `project ${projectId}: archived; restore first`).join('; '));
    manifest.complete = true;
  } catch (error) {
    failure = error;
    const detail =
      error instanceof CompanySyncError
        ? error.message
        : `Export failed while reading, verifying or writing the selected item (${filesystemCode(error)}).`;
    manifest.error = `${item}: ${detail}`;
  }
  manifest.summary.notExported = manifest.notExported.length;
  const bytes = serialize(manifest);
  try {
    await writeFile(path.join(directory, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    fail(
      `Cannot write manifest.json (${filesystemCode(error)}). ${manifest.error ?? 'The export could not be finalized.'}`,
    );
  }
  if (!manifest.complete)
    throw new CompanySyncError(
      'E_COMPANY_EXPORT',
      manifest.error ?? 'Organization export incomplete.',
      { cause: failure },
    );
  return manifest;
}
