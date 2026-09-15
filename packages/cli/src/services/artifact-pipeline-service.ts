import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDesignDocumentFile, prepareDesignArtifact } from './design-artifact-service.js';
import { isDiagramManifestFile, prepareDiagramArtifact } from './diagram-artifact-service.js';
import { resolvePipelinePackage } from './pipeline-package-service.js';

export interface ArtifactEnvelope {
  schemaVersion: string;
  artifacts: Array<{
    id: string;
    kind: 'html';
    title: string;
    sha256: string;
    html: string;
    viewport: { width: number; height: number };
    colorScheme: 'light' | 'dark';
  }>;
  viewer: {
    mode: 'single' | 'variants';
    activeArtifactId: string;
    presentation?: 'document' | 'canvas';
  };
  review?: Record<string, unknown>;
}

interface ArtifactBundle {
  html: string;
  sha256: string;
  bytes: number;
  inputBytes: number;
  fileCount: number;
  remoteAssetCount?: number;
}

export interface LiveRoomCreateResult extends Record<string, unknown> {
  id: string;
  reviewOf: string;
  expiresAt: string;
  url: string;
  ownerUrl: string;
  manageUrl: string;
  descriptor: Record<string, unknown>;
  generation: number;
  head: string;
  readonly ownerSigner: unknown;
}

export interface PreparedLiveRoomCreate extends Record<string, unknown> {
  schemaVersion: '1.0.0';
  kind: 'openplanr-live-room-preparation';
  protocolVersion: '2.0.0';
  id: string;
  roomId: string;
  reviewOf: string;
  ttl: string;
  ownerKey: Record<string, unknown>;
  readonly url: string;
  readonly ownerUrl: string;
  readonly manageUrl: string;
  readonly ownerSigner: unknown;
}

export interface LiveRoomRecoveryBundle extends Record<string, unknown> {
  schemaVersion: '1.0.0';
  kind: 'openplanr-live-room-recovery';
  protocolVersion: '2.0.0';
  id: string;
  roomId: string;
  reviewOf: string;
  ttl: string;
  ownerKey: Record<string, unknown>;
  url: string;
  ownerUrl: string;
  manageUrl: string;
  ownerSigner: Record<string, unknown>;
}

export interface ArtifactSecretBundle {
  schemaVersion: '1.0.0';
  kind: 'openplanr-artifact-share-secrets';
  transport: 'live-room' | 'fragment' | 'short';
  reviewUrl: string;
  ownerUrl?: string;
  manageUrl?: string;
  deletionToken?: string;
  ownerSigner?: Record<string, unknown>;
  readonly recovery?: LiveRoomRecoveryBundle;
}

export interface ArtifactPipelineApi {
  bundleArtifact(options: { entry: string; root: string }): Promise<ArtifactBundle>;
  createArtifactEnvelope(options: {
    artifacts: Array<{
      id: string;
      title: string;
      html: string;
      viewport: { width: number; height: number };
      colorScheme: 'light' | 'dark';
    }>;
    viewer?: ArtifactEnvelope['viewer'];
  }): ArtifactEnvelope;
  createReviewLinkPreview(envelope: ArtifactEnvelope): {
    fragmentLength: number;
    compressedBytes: number;
    ciphertextBytes: number;
    fragmentEligible: boolean;
  };
  createReviewLink(
    envelope: ArtifactEnvelope,
    options: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  createLiveReviewRoom?: (
    envelope: ArtifactEnvelope,
    options: Record<string, unknown>,
  ) => Promise<LiveRoomCreateResult>;
  prepareLiveReviewRoom?: (
    envelope: ArtifactEnvelope,
    options: Record<string, unknown>,
  ) => Promise<PreparedLiveRoomCreate>;
  exportLiveRoomRecoveryBundle?: (
    prepared: PreparedLiveRoomCreate,
  ) => Promise<LiveRoomRecoveryBundle>;
  importLiveRoomRecoveryBundle?: (
    value: LiveRoomRecoveryBundle,
    options?: Record<string, unknown>,
  ) => Promise<LiveRoomRecoveryBundle>;
  commitLiveReviewRoom?: (
    prepared: PreparedLiveRoomCreate,
    options?: Record<string, unknown>,
  ) => Promise<LiveRoomCreateResult>;
  createLiveRoomSigner?: (options: { role: 'owner' | 'reviewer' }) => Promise<unknown>;
  exportLiveRoomSignerSecret?: (signer: unknown) => Promise<Record<string, unknown>>;
  importLiveRoomSignerSecret?: (
    secret: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  hydrateLiveReviewRoom?: (
    source: string,
    options?: Record<string, unknown>,
  ) => Promise<{
    envelope: ArtifactEnvelope;
    review: Record<string, unknown>;
    protocolVersion?: string;
    mutation?: { enabled: boolean; reason: string | null };
  }>;
  decodeReviewLink(source: string, options?: Record<string, unknown>): Promise<ArtifactEnvelope>;
  importArtifactReview(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  startArtifactReview(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  exportArtifactReviewSession(
    sessionId: string,
    options: { format: 'json' | 'markdown' },
  ): Promise<{ content: string } & Record<string, unknown>>;
}

export class ArtifactCommandError extends Error {
  readonly code: string;
  readonly fix?: string;

  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = code;
    this.code = code;
    this.fix = fix;
  }

  toJSON(): Record<string, unknown> {
    return {
      ok: false,
      code: this.code,
      problem: this.message,
      ...(this.fix ? { fix: this.fix } : {}),
    };
  }
}

let cachedApi: Promise<ArtifactPipelineApi> | undefined;

export function loadArtifactPipeline(): Promise<ArtifactPipelineApi> {
  if (cachedApi) return cachedApi;
  cachedApi = (async () => {
    const pipeline = resolvePipelinePackage(false);
    if (!pipeline) {
      throw new ArtifactCommandError(
        'E_PIPELINE_NOT_INSTALLED',
        'Artifact review requires the full OpenPlanr workflow package.',
        'Run `npm install -g openplanr@latest` to install it.',
      );
    }
    const entry = path.join(pipeline.root, 'lib', 'pipeline', 'index.mjs');
    const value = (await import(pathToFileURL(entry).href)) as Partial<ArtifactPipelineApi>;
    const required: Array<keyof ArtifactPipelineApi> = [
      'bundleArtifact',
      'createArtifactEnvelope',
      'createReviewLinkPreview',
      'createReviewLink',
      'decodeReviewLink',
      'importArtifactReview',
      'startArtifactReview',
      'exportArtifactReviewSession',
    ];
    const missing = required.filter((name) => typeof value[name] !== 'function');
    if (missing.length > 0) {
      throw new ArtifactCommandError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        `Installed planr-pipeline ${pipeline.version} lacks: ${missing.join(', ')}.`,
        'Run `npm install -g openplanr@latest` to install the compatible pipeline.',
      );
    }
    return value as ArtifactPipelineApi;
  })();
  return cachedApi;
}

function artifactId(file: string, root: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(file)).replaceAll(path.sep, '/');
  const stem = path.basename(file, path.extname(file));
  const slug =
    stem
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'artifact';
  const suffix = createHash('sha256').update(relative).digest('hex').slice(0, 8);
  return `${slug}-${suffix}`;
}

export async function prepareArtifactEnvelope(options: {
  file: string;
  root: string;
  title?: string;
  presentation?: 'auto' | 'document' | 'canvas';
}): Promise<{
  api: ArtifactPipelineApi;
  envelope: ArtifactEnvelope;
  bundle: ArtifactBundle;
  artifactId: string;
  presentation: 'document' | 'canvas';
}> {
  const api = await loadArtifactPipeline();
  const file = path.resolve(options.file);
  const root = path.resolve(options.root);
  if (isDesignDocumentFile(file)) {
    const envelope = await prepareDesignArtifact(file);
    const html = envelope.artifacts.map((artifact) => artifact.html).join('\n');
    return {
      api,
      envelope,
      artifactId: envelope.viewer.activeArtifactId,
      presentation: 'canvas',
      bundle: {
        html,
        sha256: createHash('sha256').update(html).digest('hex'),
        bytes: Buffer.byteLength(html),
        fileCount: envelope.artifacts.length,
        remoteAssetCount: 0,
      } as ArtifactBundle,
    };
  }
  if (isDiagramManifestFile(file)) {
    const envelope = await prepareDiagramArtifact(file);
    const html = envelope.artifacts.map((artifact) => artifact.html).join('\n');
    return {
      api,
      envelope,
      artifactId: envelope.viewer.activeArtifactId,
      presentation: 'canvas',
      bundle: {
        html,
        sha256: createHash('sha256').update(html).digest('hex'),
        bytes: Buffer.byteLength(html),
        inputBytes: Buffer.byteLength(html),
        fileCount: envelope.artifacts.length,
        remoteAssetCount: 0,
      },
    };
  }
  const bundle = await api.bundleArtifact({ entry: file, root });
  const id = artifactId(file, root);
  const presentation = options.presentation === 'canvas' ? 'canvas' : 'document';
  const envelope = api.createArtifactEnvelope({
    artifacts: [
      {
        id,
        title: options.title?.trim() || path.basename(file, path.extname(file)),
        html: bundle.html,
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
      },
    ],
    ...(options.presentation === 'auto' || options.presentation === undefined
      ? {}
      : {
          viewer: {
            mode: 'single' as const,
            activeArtifactId: id,
            presentation: options.presentation,
          },
        }),
  });
  return { api, envelope, bundle, artifactId: id, presentation };
}

export function withoutArtifactReview(envelope: ArtifactEnvelope): ArtifactEnvelope {
  return {
    schemaVersion: envelope.schemaVersion,
    artifacts: structuredClone(envelope.artifacts),
    viewer: structuredClone(envelope.viewer),
  };
}

export async function openExternalUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_BROWSER_OPEN_FAILED',
      'Refusing to open a malformed URL.',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_BROWSER_OPEN_FAILED',
      'Browser URLs require HTTPS, except exact loopback HTTP, and cannot contain credentials.',
    );
  }
  const command =
    process.platform === 'darwin'
      ? { file: 'open', args: [url] }
      : process.platform === 'win32'
        ? { file: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
        : { file: 'xdg-open', args: [url] };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Keep capability-bearing URLs out of process argv by opening an opaque one-shot loopback handoff. */
export async function openArtifactSecretUrl(
  url: string,
  { openUrl = openExternalUrl }: { openUrl?: (value: string) => Promise<void> } = {},
): Promise<void> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_BROWSER_OPEN_FAILED',
      'Secret artifact URL is malformed.',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname);
  if (
    target.username ||
    target.password ||
    (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback))
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_BROWSER_OPEN_FAILED',
      'Secret artifact URL transport is invalid.',
    );
  }
  const nonce = randomBytes(32).toString('hex');
  let expectedHost = '';
  const safeHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    if (
      request.method !== 'GET' ||
      request.url !== `/handoff/${nonce}` ||
      request.headers.host !== expectedHost ||
      (origin !== undefined && origin !== `http://${expectedHost}`)
    ) {
      response.writeHead(404, safeHeaders).end();
      return;
    }
    response
      .writeHead(302, {
        location: target.toString(),
        ...safeHeaders,
      })
      .end();
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new ArtifactCommandError(
      'E_ARTIFACT_BROWSER_OPEN_FAILED',
      'Secret browser handoff could not bind loopback.',
    );
  }
  expectedHost = `127.0.0.1:${address.port}`;
  const timer = setTimeout(() => server.close(), 60_000);
  timer.unref();
  try {
    await openUrl(`http://127.0.0.1:${address.port}/handoff/${nonce}`);
  } catch (error) {
    clearTimeout(timer);
    server.close();
    throw error;
  }
}

const SECRET_FILE_LIMIT = 1024 * 1024;

export interface ArtifactSecretExportReservation {
  readonly output: string;
  finalize(value: ArtifactSecretBundle | LiveRoomRecoveryBundle): void;
  abort(): void;
  revoke(): void;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

function secretExportError(message: string, fix?: string): ArtifactCommandError {
  return new ArtifactCommandError('E_ARTIFACT_SECRET_EXPORT', message, fix);
}

function serializeArtifactSecretExport(
  value: ArtifactSecretBundle | LiveRoomRecoveryBundle,
): Buffer {
  let json: string | undefined;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    throw secretExportError('Artifact secret export could not be serialized safely.');
  }
  if (typeof json !== 'string') {
    throw secretExportError('Artifact secret export could not be serialized safely.');
  }
  const serialized = Buffer.from(`${json}\n`, 'utf8');
  if (serialized.byteLength > SECRET_FILE_LIMIT) {
    throw secretExportError('Artifact secret export exceeds its bounded size.');
  }
  return serialized;
}

function sameFile(pathname: string, identity: FileIdentity): boolean {
  try {
    const info = lstatSync(pathname);
    return info.isFile() && info.dev === identity.dev && info.ino === identity.ino;
  } catch {
    return false;
  }
}

function writeAllAt(descriptor: number, bytes: Buffer, position: number): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(
      descriptor,
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset,
    );
    if (written <= 0) throw new Error('secret sink write did not progress');
    offset += written;
  }
}

/**
 * Reserve and provision the exact output inode before any remote effect.
 *
 * The file stays mode 000 until its complete JSON bytes are durable. The final
 * chmod to 0600 is the atomic visibility boundary, and every byte is written
 * through the descriptor opened with O_EXCL/O_NOFOLLOW during reservation.
 */
export function reserveArtifactSecretExport(output: string): ArtifactSecretExportReservation {
  if (!output || output === '-') {
    throw secretExportError(
      'Secret export requires a named file; stdout is not a safe secret sink.',
    );
  }
  const target = path.resolve(output);
  let descriptor: number | undefined;
  let identity: FileIdentity | undefined;
  let state: 'reserved' | 'finalized' | 'aborted' | 'revoked' = 'reserved';
  try {
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    descriptor = openSync(
      target,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      0o000,
    );
    const info = fstatSync(descriptor);
    if (!info.isFile()) throw new Error('not a regular file');
    identity = { dev: info.dev, ino: info.ino };
    fchmodSync(descriptor, 0o000);
    writeAllAt(descriptor, randomBytes(SECRET_FILE_LIMIT), 0);
    ftruncateSync(descriptor, SECRET_FILE_LIMIT);
    fsyncSync(descriptor);
    fchmodSync(descriptor, 0o600);
    fchmodSync(descriptor, 0o000);
    fsyncSync(descriptor);
  } catch {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort cleanup follows through the validated path identity.
      }
    }
    if (identity && sameFile(target, identity)) {
      try {
        unlinkSync(target);
      } catch {
        // The bounded error below remains authoritative.
      }
    }
    throw secretExportError(
      'Artifact secret export could not be created exclusively with restrictive permissions.',
      'Choose a new path in a private directory.',
    );
  }

  const closeDescriptor = () => {
    if (descriptor === undefined) return;
    try {
      closeSync(descriptor);
    } finally {
      descriptor = undefined;
    }
  };

  const abort = () => {
    if (state !== 'reserved') return;
    state = 'aborted';
    try {
      closeDescriptor();
    } catch {
      // Cleanup must not replace the bounded command error that caused abort.
    }
    if (identity && sameFile(target, identity)) {
      try {
        unlinkSync(target);
      } catch {
        // Never replace the original bounded command error with cleanup detail.
      }
    }
  };

  return Object.freeze({
    output: target,
    finalize(value: ArtifactSecretBundle | LiveRoomRecoveryBundle): void {
      if (state !== 'reserved' || descriptor === undefined || !identity) {
        throw secretExportError('Artifact secret export reservation is no longer active.');
      }
      const serialized = serializeArtifactSecretExport(value);
      try {
        if (!sameFile(target, identity)) throw new Error('secret sink identity changed');
        writeAllAt(descriptor, serialized, 0);
        ftruncateSync(descriptor, serialized.byteLength);
        fsyncSync(descriptor);
        fchmodSync(descriptor, 0o600);
        state = 'finalized';
        fsyncSync(descriptor);
        try {
          closeDescriptor();
        } catch {
          // The durable 0600 file is already authoritative; close cannot revoke custody.
        }
      } catch {
        if (state === 'finalized') {
          try {
            closeDescriptor();
          } catch {
            // Preserve the complete 0600 recovery file even if descriptor close fails.
          }
        } else {
          abort();
        }
        throw secretExportError(
          'Artifact secret export could not be finalized securely.',
          'Choose a new path in a private directory and retry.',
        );
      }
    },
    abort,
    revoke(): void {
      if (state !== 'finalized' || !identity) {
        throw secretExportError('Artifact secret export cannot be revoked from this state.');
      }
      if (!sameFile(target, identity)) {
        throw secretExportError(
          'Artifact secret export identity changed before safe revocation.',
          'Inspect the private destination without deleting or overwriting it.',
        );
      }
      try {
        unlinkSync(target);
        state = 'revoked';
      } catch {
        throw secretExportError(
          'Artifact secret export could not be revoked safely.',
          'Inspect the private destination without deleting or overwriting it.',
        );
      }
    },
  });
}

export function writeArtifactSecretExport(output: string, value: ArtifactSecretBundle): void {
  const reservation = reserveArtifactSecretExport(output);
  try {
    reservation.finalize(value);
  } catch (error) {
    reservation.abort();
    throw error;
  }
}

function assertLiveRoomRecoveryBundle(
  value: LiveRoomRecoveryBundle,
  prepared: PreparedLiveRoomCreate,
): LiveRoomRecoveryBundle {
  const allowed = new Set([
    'schemaVersion',
    'kind',
    'protocolVersion',
    'id',
    'roomId',
    'reviewOf',
    'ttl',
    'ownerKey',
    'url',
    'ownerUrl',
    'manageUrl',
    'ownerSigner',
  ]);
  const ownerKey = value?.ownerKey as Record<string, unknown> | undefined;
  const preparedOwnerKey = prepared?.ownerKey as Record<string, unknown> | undefined;
  const signer = value?.ownerSigner as Record<string, unknown> | undefined;
  const ownerKeyNames = ['algorithm', 'encoding', 'keyId', 'value'];
  const signerNames = [
    'schemaVersion',
    'kind',
    'role',
    'algorithm',
    'keyId',
    'publicKey',
    'privateKey',
  ];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schemaVersion !== '1.0.0' ||
    value.kind !== 'openplanr-live-room-recovery' ||
    value.protocolVersion !== '2.0.0' ||
    typeof value.id !== 'string' ||
    value.roomId !== value.id ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(value.id) ||
    !/^[a-f0-9]{64}$/u.test(value.reviewOf) ||
    !['1d', '7d', '30d'].includes(value.ttl) ||
    prepared.schemaVersion !== '1.0.0' ||
    prepared.kind !== 'openplanr-live-room-preparation' ||
    prepared.protocolVersion !== '2.0.0' ||
    value.id !== prepared.id ||
    value.roomId !== prepared.roomId ||
    value.reviewOf !== prepared.reviewOf ||
    value.ttl !== prepared.ttl ||
    typeof value.url !== 'string' ||
    typeof value.ownerUrl !== 'string' ||
    typeof value.manageUrl !== 'string' ||
    value.url !== prepared.url ||
    value.ownerUrl !== prepared.ownerUrl ||
    value.manageUrl !== prepared.manageUrl ||
    !ownerKey ||
    Array.isArray(ownerKey) ||
    Object.keys(ownerKey).length !== ownerKeyNames.length ||
    ownerKeyNames.some((key) => !Object.hasOwn(ownerKey, key)) ||
    ownerKey.algorithm !== 'ECDSA-P256-SHA256' ||
    ownerKey.encoding !== 'spki-base64url' ||
    typeof ownerKey.keyId !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(ownerKey.keyId) ||
    typeof ownerKey.value !== 'string' ||
    !/^[A-Za-z0-9_-]{64,512}$/u.test(ownerKey.value) ||
    !preparedOwnerKey ||
    ownerKeyNames.some((key) => ownerKey[key] !== preparedOwnerKey[key]) ||
    !signer ||
    Array.isArray(signer) ||
    Object.keys(signer).length !== signerNames.length ||
    signerNames.some((key) => !Object.hasOwn(signer, key)) ||
    signer.schemaVersion !== '1.0.0' ||
    signer.kind !== 'openplanr-live-room-signer' ||
    signer.role !== 'owner' ||
    signer.algorithm !== ownerKey.algorithm ||
    signer.keyId !== ownerKey.keyId ||
    signer.publicKey !== ownerKey.value ||
    typeof signer.privateKey !== 'string' ||
    !/^[A-Za-z0-9_-]{64,1024}$/u.test(signer.privateKey)
  ) {
    throw secretExportError('Live review recovery custody has an unsupported shape.');
  }
  return value;
}

function assertImportedRecoverySigner(
  signer: Record<string, unknown>,
  ownerKey: Record<string, unknown>,
): void {
  if (
    signer.role !== 'owner' ||
    signer.algorithm !== ownerKey.algorithm ||
    signer.encoding !== ownerKey.encoding ||
    signer.keyId !== ownerKey.keyId ||
    signer.value !== ownerKey.value ||
    typeof signer.sign !== 'function'
  ) {
    throw secretExportError('Live review recovery signer does not match its owner key.');
  }
}

function assertLiveRoomSecretCapacity(baseUrl: string, ownerSigner: Record<string, unknown>): void {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      'Live review service URL is malformed.',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      'Live review service URLs require HTTPS, except exact loopback HTTP, and cannot contain credentials or redirects.',
    );
  }
  const roomId = 'r'.repeat(128);
  const key = 'A'.repeat(43);
  const capability = 'B'.repeat(43);
  const roomUrl = `${base.origin}/r/${roomId}`;
  serializeArtifactSecretExport({
    schemaVersion: '1.0.0',
    kind: 'openplanr-artifact-share-secrets',
    transport: 'live-room',
    reviewUrl: `${roomUrl}#k=${key}&w=${capability}`,
    ownerUrl: `${roomUrl}#k=${key}&o=${capability}`,
    manageUrl: `${roomUrl}#k=${key}&m=${capability}`,
    ownerSigner,
  });
}

export async function createLiveReviewRoomWithSecretCustody(options: {
  api: ArtifactPipelineApi;
  envelope: ArtifactEnvelope;
  output: string;
  baseUrl: string;
  ttl: string;
}): Promise<LiveRoomCreateResult> {
  const { api } = options;
  if (
    typeof api.prepareLiveReviewRoom !== 'function' ||
    typeof api.exportLiveRoomRecoveryBundle !== 'function' ||
    typeof api.commitLiveReviewRoom !== 'function' ||
    typeof api.importLiveRoomRecoveryBundle !== 'function'
  ) {
    throw new ArtifactCommandError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The installed planr-pipeline does not support preflighted signed live-room custody.',
    );
  }
  if (!['1d', '7d', '30d'].includes(options.ttl)) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      'Live review TTL must be 1d, 7d, or 30d.',
    );
  }

  const reservation = reserveArtifactSecretExport(options.output);
  let custodyDurable = false;
  try {
    const prepared = await api.prepareLiveReviewRoom(options.envelope, {
      baseUrl: options.baseUrl,
      ttl: options.ttl,
    });
    const recovery = assertLiveRoomRecoveryBundle(
      await api.exportLiveRoomRecoveryBundle(prepared),
      prepared,
    );
    assertImportedRecoverySigner(
      (await api.importLiveRoomRecoveryBundle(recovery)).ownerSigner,
      recovery.ownerKey,
    );
    assertLiveRoomSecretCapacity(options.baseUrl, recovery.ownerSigner);
    reservation.finalize(recovery);
    custodyDurable = true;
    let error: unknown;
    try {
      return await api.commitLiveReviewRoom(prepared, { baseUrl: options.baseUrl });
    } catch (firstError) {
      const first = firstError as { code?: unknown; details?: { effect?: unknown } };
      if (
        first.code === 'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS' &&
        first.details?.effect === 'ambiguous'
      ) {
        try {
          return await api.commitLiveReviewRoom(prepared, { baseUrl: options.baseUrl });
        } catch (retryError) {
          error = retryError;
        }
      } else {
        error = firstError;
      }
    }
    {
      const effect =
        error && typeof error === 'object'
          ? (error as { details?: { effect?: unknown } }).details?.effect
          : undefined;
      if (effect === 'none') {
        reservation.revoke();
        throw error;
      }
      throw new ArtifactCommandError(
        'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS',
        'Live review room creation could not be confirmed. Private recovery custody was preserved.',
        'Use the preserved --secret-output file to inspect the exact room; do not create another room until its state is known.',
      );
    }
  } catch (error) {
    if (!custodyDurable) reservation.abort();
    throw error;
  }
}

function parseSecretBundle(source: string): ArtifactSecretBundle {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Artifact secret input is not valid JSON.',
    );
  }
  const recovery = value as Partial<LiveRoomRecoveryBundle>;
  if (recovery?.kind === 'openplanr-live-room-recovery') {
    let normalized: LiveRoomRecoveryBundle;
    try {
      normalized = assertLiveRoomRecoveryBundle(recovery as LiveRoomRecoveryBundle, {
        schemaVersion: '1.0.0',
        kind: 'openplanr-live-room-preparation',
        protocolVersion: '2.0.0',
        id: String(recovery.id),
        roomId: String(recovery.roomId),
        reviewOf: String(recovery.reviewOf),
        ttl: String(recovery.ttl),
        ownerKey: recovery.ownerKey as Record<string, unknown>,
        url: String(recovery.url),
        ownerUrl: String(recovery.ownerUrl),
        manageUrl: String(recovery.manageUrl),
        ownerSigner: null,
      });
    } catch {
      throw new ArtifactCommandError(
        'E_ARTIFACT_SECRET_INPUT',
        'Artifact secret input has an unsupported recovery shape.',
      );
    }
    const urls = [
      { value: normalized.url, capability: 'w' },
      { value: normalized.ownerUrl, capability: 'o' },
      { value: normalized.manageUrl, capability: 'm' },
    ] as const;
    let origin = '';
    let encryptionKey = '';
    const authorities = new Set<string>();
    for (const entry of urls) {
      let parsed: URL;
      try {
        parsed = new URL(entry.value);
      } catch {
        throw new ArtifactCommandError(
          'E_ARTIFACT_SECRET_INPUT',
          'Live review recovery URL is invalid.',
        );
      }
      const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
      const parameters = [...new URLSearchParams(parsed.hash.slice(1)).entries()];
      const names = parameters.map(([name]) => name);
      const key = parameters.find(([name]) => name === 'k')?.[1];
      const authority = parameters.find(([name]) => name === entry.capability)?.[1];
      if (
        parsed.username ||
        parsed.password ||
        parsed.search ||
        (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
        parsed.pathname !== `/r/${normalized.roomId}` ||
        parameters.length !== 2 ||
        names.filter((name) => name === 'k').length !== 1 ||
        names.filter((name) => name === entry.capability).length !== 1 ||
        !key ||
        !/^[A-Za-z0-9_-]{43}$/u.test(key) ||
        !authority ||
        !/^[A-Za-z0-9_-]{43}$/u.test(authority)
      ) {
        throw new ArtifactCommandError(
          'E_ARTIFACT_SECRET_INPUT',
          'Live review recovery URL custody is invalid.',
        );
      }
      if ((origin && parsed.origin !== origin) || (encryptionKey && key !== encryptionKey)) {
        throw new ArtifactCommandError(
          'E_ARTIFACT_SECRET_INPUT',
          'Live review recovery URLs do not share exact room custody.',
        );
      }
      if (authorities.has(authority)) {
        throw new ArtifactCommandError(
          'E_ARTIFACT_SECRET_INPUT',
          'Live review recovery authorities are not separate.',
        );
      }
      origin = parsed.origin;
      encryptionKey = key;
      authorities.add(authority);
    }
    const projected: ArtifactSecretBundle = {
      schemaVersion: '1.0.0',
      kind: 'openplanr-artifact-share-secrets',
      transport: 'live-room',
      reviewUrl: normalized.url,
      ownerUrl: normalized.ownerUrl,
      manageUrl: normalized.manageUrl,
      ownerSigner: normalized.ownerSigner,
    };
    Object.defineProperty(projected, 'recovery', {
      enumerable: false,
      value: Object.freeze(structuredClone(normalized)),
    });
    return Object.freeze(projected);
  }

  const item = value as Partial<ArtifactSecretBundle>;
  const allowed = new Set([
    'schemaVersion',
    'kind',
    'transport',
    'reviewUrl',
    'ownerUrl',
    'manageUrl',
    'deletionToken',
    'ownerSigner',
  ]);
  if (
    !item ||
    typeof item !== 'object' ||
    Array.isArray(item) ||
    Object.keys(item).some((key) => !allowed.has(key)) ||
    item.schemaVersion !== '1.0.0' ||
    item.kind !== 'openplanr-artifact-share-secrets' ||
    !['live-room', 'fragment', 'short'].includes(String(item.transport)) ||
    typeof item.reviewUrl !== 'string' ||
    (item.ownerUrl !== undefined && typeof item.ownerUrl !== 'string') ||
    (item.manageUrl !== undefined && typeof item.manageUrl !== 'string') ||
    (item.deletionToken !== undefined && typeof item.deletionToken !== 'string') ||
    (item.ownerSigner !== undefined &&
      (typeof item.ownerSigner !== 'object' ||
        item.ownerSigner === null ||
        Array.isArray(item.ownerSigner)))
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Artifact secret input has an unsupported shape.',
    );
  }
  let reviewUrl: URL;
  try {
    reviewUrl = new URL(item.reviewUrl);
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Artifact secret input URL is invalid.',
    );
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(reviewUrl.hostname);
  if (
    reviewUrl.username ||
    reviewUrl.password ||
    (reviewUrl.protocol !== 'https:' && !(reviewUrl.protocol === 'http:' && loopback))
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Artifact secret input URL transport is invalid.',
    );
  }
  return item as ArtifactSecretBundle;
}

export function readArtifactSecretInput(input: string): ArtifactSecretBundle {
  if (input === '-') {
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, SECRET_FILE_LIMIT + 1 - total));
      const read = readSync(0, chunk, 0, chunk.length, null);
      if (read === 0) break;
      total += read;
      if (total > SECRET_FILE_LIMIT)
        throw new ArtifactCommandError(
          'E_ARTIFACT_SECRET_INPUT',
          'Artifact secret input exceeds its bounded size.',
        );
      chunks.push(chunk.subarray(0, read));
    }
    return parseSecretBundle(Buffer.concat(chunks).toString('utf8'));
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > SECRET_FILE_LIMIT || (info.mode & 0o077) !== 0) {
      throw new ArtifactCommandError(
        'E_ARTIFACT_SECRET_INPUT',
        'Artifact secret input must be a bounded regular file without group or world permissions.',
      );
    }
    return parseSecretBundle(readFileSync(descriptor, 'utf8'));
  } catch (error) {
    if (error instanceof ArtifactCommandError) throw error;
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Artifact secret input could not be read.',
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Authenticate canonical recovery custody against the room descriptor before it
 * is used as an ordinary artifact secret input. Legacy secret bundles have no
 * recovery assertion and retain their existing compatibility behavior.
 */
export async function verifyLiveRoomRecoveryCustody(
  api: ArtifactPipelineApi,
  secret: ArtifactSecretBundle,
  room: Record<string, unknown>,
): Promise<void> {
  const recovery = secret.recovery;
  if (!recovery) return;
  if (typeof api.importLiveRoomRecoveryBundle !== 'function') {
    throw new ArtifactCommandError(
      'E_PIPELINE_VERSION_INCOMPATIBLE',
      'The installed planr-pipeline cannot authenticate live-room recovery custody.',
    );
  }
  const descriptor = room.descriptor as Record<string, unknown> | undefined;
  const descriptorOwnerKey = descriptor?.ownerKey as Record<string, unknown> | undefined;
  const expectedOwnerKey = recovery.ownerKey;
  const keyNames = ['algorithm', 'encoding', 'keyId', 'value'];
  if (
    !descriptor ||
    descriptor.roomId !== recovery.roomId ||
    descriptor.reviewOf !== recovery.reviewOf ||
    room.reviewOf !== recovery.reviewOf ||
    !descriptorOwnerKey ||
    keyNames.some((key) => descriptorOwnerKey[key] !== expectedOwnerKey[key])
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Live review recovery custody does not match the authenticated room descriptor.',
    );
  }
  let signer: Record<string, unknown>;
  try {
    signer = (await api.importLiveRoomRecoveryBundle(recovery)).ownerSigner;
  } catch {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Live review recovery signer could not be authenticated.',
    );
  }
  if (
    signer.role !== 'owner' ||
    signer.algorithm !== expectedOwnerKey.algorithm ||
    signer.encoding !== expectedOwnerKey.encoding ||
    signer.keyId !== expectedOwnerKey.keyId ||
    signer.value !== expectedOwnerKey.value ||
    typeof signer.sign !== 'function'
  ) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Live review recovery signer does not match the authenticated room owner.',
    );
  }
}

export function resetArtifactPipelineForTests(): void {
  cachedApi = undefined;
}
