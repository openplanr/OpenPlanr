import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import {
  ArtifactCommandError,
  type ArtifactEnvelope,
  createLiveReviewRoomWithSecretCustody,
  loadArtifactPipeline,
  openArtifactSecretUrl,
  openExternalUrl,
  prepareArtifactEnvelope,
  readArtifactSecretInput,
  reserveArtifactSecretExport,
  verifyLiveRoomRecoveryCustody,
  withoutArtifactReview,
} from '../../services/artifact-pipeline-service.js';
import {
  isDesignDocumentFile,
  openDesignArtifact,
  prepareDesignHandoff,
  runDesignShareAction,
} from '../../services/design-artifact-service.js';
import {
  isDiagramManifestFile,
  openDiagramArtifact,
} from '../../services/diagram-artifact-service.js';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';

type Theme = 'auto' | 'light' | 'dark';
type Presentation = 'auto' | 'document' | 'canvas';
type ExportFormat = 'json' | 'markdown';

interface OpenOptions {
  title?: string;
  root?: string;
  theme?: string;
  port?: string;
  open?: boolean;
  json?: boolean;
  presentation?: string;
}

interface ShareOptions {
  title?: string;
  root?: string;
  short?: boolean;
  ttl?: string;
  open?: boolean;
  json?: boolean;
  yes?: boolean;
  presentation?: string;
  snapshot?: boolean;
  secretOutput?: string;
}

interface ImportOptions {
  output?: string;
  allowStale?: boolean;
  json?: boolean;
  yes?: boolean;
  secretInput?: string;
}

function projectDir(program: Command): string {
  return path.resolve(program.opts().projectDir as string);
}

function resolveInput(program: Command, value: string): string {
  return path.resolve(projectDir(program), value);
}

function resolveRoot(program: Command, input: string, value?: string): string {
  return value === undefined ? path.dirname(input) : path.resolve(projectDir(program), value);
}

function theme(value?: string): Theme {
  if (value === undefined) return 'auto';
  if (['auto', 'light', 'dark'].includes(value)) return value as Theme;
  throw new ArtifactCommandError(
    'E_ARTIFACT_INPUT_INVALID',
    'Artifact theme must be auto, light, or dark.',
  );
}

function port(value?: string): number {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      'Artifact review port must be an integer from 0 through 65535.',
    );
  }
  return parsed;
}

function presentation(value?: string): Presentation {
  if (value === undefined) return 'auto';
  if (['auto', 'document', 'canvas'].includes(value)) return value as Presentation;
  throw new ArtifactCommandError(
    'E_ARTIFACT_INPUT_INVALID',
    'Artifact presentation must be auto, document, or canvas.',
  );
}

function confirmed(program: Command, local?: boolean): boolean {
  return Boolean(local || program.opts().yes);
}

async function openArtifact(program: Command, file: string, options: OpenOptions): Promise<void> {
  const cwd = projectDir(program);
  const input = resolveInput(program, file);
  if (isDesignDocumentFile(input)) {
    const session = await openDesignArtifact(input, {
      port: port(options.port),
      noOpen: options.open === false,
      openUrl: openExternalUrl,
    });
    if (options.json) display.line(JSON.stringify(session));
    else {
      display.keyValue('Design studio', session.url);
      display.keyValue(
        'Status',
        'Loading; browser readiness and visual verification are reported separately.',
      );
      display.keyValue('Feedback', session.reviewPath);
      if (session.draftError)
        display.keyValue(
          'Draft needs attention; showing the last working revision',
          session.draftError,
        );
    }
    if (session.close) {
      const close = session.close;
      const shutdown = async () => {
        await close();
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
    return;
  }
  if (isDiagramManifestFile(input)) {
    const session = await openDiagramArtifact(input, {
      port: port(options.port),
      noOpen: options.open === false,
      openUrl: openExternalUrl,
    });
    if (options.json) display.line(JSON.stringify(session));
    else {
      display.keyValue('Diagram studio', session.url);
      display.keyValue('Feedback', session.reviewPath);
      logger.dim('Press Ctrl+C to stop the local diagram studio.');
    }
    if (session.close) {
      const close = session.close;
      const shutdown = async () => {
        await close();
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
    return;
  }
  const prepared = await prepareArtifactEnvelope({
    file: input,
    root: resolveRoot(program, input, options.root),
    title: options.title,
    presentation: presentation(options.presentation),
  });
  const session = await prepared.api.startArtifactReview({
    envelope: prepared.envelope,
    title: options.title,
    theme: theme(options.theme),
    port: port(options.port),
    noOpen: options.open === false,
    cwd,
    openUrl: openExternalUrl,
  });
  if (options.json)
    display.line(JSON.stringify({ ...session, presentation: prepared.presentation }));
  else {
    logger.success('Artifact review ready');
    display.keyValue('Session', String(session.sessionId));
    display.keyValue('URL', String(session.url));
    display.keyValue('Files', String(prepared.bundle.fileCount));
    if (prepared.bundle.remoteAssetCount) {
      display.keyValue('Remote assets', String(prepared.bundle.remoteAssetCount));
    }
    display.keyValue('Bundled', `${prepared.bundle.bytes.toLocaleString()} bytes`);
    display.keyValue('Presentation', prepared.presentation);
    display.blank();
    logger.dim('Press Ctrl+C to stop the local review session.');
  }
  const close = typeof session.close === 'function' ? session.close.bind(session) : undefined;
  if (close) {
    const shutdown = async () => {
      await close().catch(() => undefined);
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}

async function shareArtifact(program: Command, file: string, options: ShareOptions): Promise<void> {
  const designInput = resolveInput(program, file);
  if (isDesignDocumentFile(designInput)) {
    if (options.ttl !== undefined)
      throw new ArtifactCommandError(
        'E_ARTIFACT_INPUT_INVALID',
        'Design reviews remain available until revoked or deleted; --ttl applies to generic artifact links.',
      );
    if (options.snapshot || options.short)
      throw new ArtifactCommandError(
        'E_ARTIFACT_INPUT_INVALID',
        'Design documents use persistent token-protected sharing. Export HTML first to create a generic snapshot.',
      );
    await runDesignSharing(program, file, options, 'share');
    return;
  }
  if (options.short && !options.snapshot) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      '`--short` selects encrypted snapshot transport and requires `--snapshot`.',
      'Use `planr artifact share <file> --snapshot --short --yes`, or omit both options to create a live room.',
    );
  }
  if (options.snapshot && options.open === false && !options.secretOutput) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_EXPORT',
      'A non-opened encrypted snapshot requires explicit private secret export.',
      'Rerun with `--secret-output <private-file>`.',
    );
  }
  const input = resolveInput(program, file);
  const prepared = await prepareArtifactEnvelope({
    file: input,
    root: resolveRoot(program, input, options.root),
    title: options.title,
    presentation: presentation(options.presentation),
  });
  const yes = confirmed(program, options.yes);
  if (!options.snapshot) {
    if (
      typeof prepared.api.prepareLiveReviewRoom !== 'function' ||
      typeof prepared.api.exportLiveRoomRecoveryBundle !== 'function' ||
      typeof prepared.api.commitLiveReviewRoom !== 'function' ||
      typeof prepared.api.importLiveRoomRecoveryBundle !== 'function'
    ) {
      throw new ArtifactCommandError(
        'E_PIPELINE_VERSION_INCOMPATIBLE',
        'The installed planr-pipeline does not support signed encrypted live review rooms.',
        'Run `npm install -g openplanr@latest` after the compatible pipeline release is available, or use `--snapshot`.',
      );
    }
    if (!options.secretOutput) {
      throw new ArtifactCommandError(
        'E_ARTIFACT_SECRET_EXPORT',
        'Signed live rooms require explicit private owner-custody export.',
        'Rerun with `--secret-output <private-file>`; the file is created exclusively with mode 0600.',
      );
    }
    let allowLive = yes;
    if (!allowLive) {
      if (isNonInteractive()) {
        throw new ArtifactCommandError(
          'E_ARTIFACT_CONFIRMATION_REQUIRED',
          'Live review rooms upload encrypted ciphertext and require explicit confirmation.',
          'Rerun with `planr artifact share <file> --yes`.',
        );
      }
      display.keyValue('Expiry', options.ttl ?? '7d');
      allowLive = await promptConfirm(
        'Create an encrypted live review room with separate reviewer, owner, and management authority?',
        true,
      );
    }
    if (!allowLive) return;
    const result = await createLiveReviewRoomWithSecretCustody({
      api: prepared.api,
      envelope: prepared.envelope,
      output: path.resolve(projectDir(program), options.secretOutput),
      baseUrl: process.env.OPENPLANR_SHARE_BASE ?? 'https://share.openplanr.dev',
      ttl: options.ttl ?? '7d',
    });
    if (options.open !== false) await openArtifactSecretUrl(result.url);
    const safe = {
      ok: true,
      action: 'artifact_live_room_created',
      transport: 'live-room',
      handle: result.id,
      expiresAt: result.expiresAt,
      presentation: prepared.presentation,
      opened: options.open !== false,
      secretExported: true,
    };
    if (options.json) {
      display.line(JSON.stringify(safe));
    } else {
      logger.success('Encrypted live review room created');
      display.keyValue('Room', result.id);
      if (prepared.bundle.remoteAssetCount) {
        display.keyValue('Remote assets', String(prepared.bundle.remoteAssetCount));
      }
      display.keyValue('Presentation', prepared.presentation);
      if (result.expiresAt) display.keyValue('Expires', String(result.expiresAt));
      display.keyValue('Private custody', 'exported');
      logger.dim(
        'The private file contains separate reviewer, owner-verdict, and room-management capabilities.',
      );
    }
    return;
  }
  const preview = prepared.api.createReviewLinkPreview(prepared.envelope);
  if (!preview.fragmentEligible && isNonInteractive() && !(options.short && yes)) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SHORT_CONFIRMATION_REQUIRED',
      'This artifact is too large for a private fragment link.',
      'Rerun with `planr artifact share <file> --short --yes` to upload encrypted ciphertext.',
    );
  }
  const needsConsent = Boolean(options.short || !preview.fragmentEligible);
  let allowShort = yes;
  if (needsConsent && !allowShort) {
    if (isNonInteractive()) {
      throw new ArtifactCommandError(
        'E_ARTIFACT_SHORT_CONFIRMATION_REQUIRED',
        'Encrypted short-link creation requires explicit confirmation.',
        'Rerun with `--short --yes`.',
      );
    }
    display.keyValue('Encrypted size', `${preview.ciphertextBytes.toLocaleString()} bytes`);
    display.keyValue('Expiry', options.ttl ?? '7d');
    allowShort = await promptConfirm(
      'Upload ciphertext to share.openplanr.dev? The decryption key remains in the URL fragment.',
      true,
    );
  }
  const secretReservation = options.secretOutput
    ? reserveArtifactSecretExport(path.resolve(projectDir(program), options.secretOutput))
    : undefined;
  let result: Record<string, unknown>;
  try {
    result = await prepared.api.createReviewLink(prepared.envelope, {
      baseUrl: process.env.OPENPLANR_SHARE_BASE ?? 'https://share.openplanr.dev',
      short: Boolean(options.short),
      transport: options.short ? 'short' : 'auto',
      ttl: options.ttl ?? '7d',
      confirmed: allowShort,
      yes: allowShort,
    });
    if (secretReservation) {
      secretReservation.finalize({
        schemaVersion: '1.0.0',
        kind: 'openplanr-artifact-share-secrets',
        transport: result.transport === 'short' ? 'short' : 'fragment',
        reviewUrl: String(result.url),
        ...(result.deletionToken ? { deletionToken: String(result.deletionToken) } : {}),
      });
    }
  } catch (error) {
    secretReservation?.abort();
    throw error;
  }
  const url = String(result.url);
  if (options.open !== false) await openArtifactSecretUrl(url);
  const safe = {
    ok: true,
    action: 'artifact_snapshot_created',
    transport: String(result.transport),
    uploaded: Boolean(result.uploaded),
    expiresAt: result.expiresAt,
    presentation: prepared.presentation,
    opened: options.open !== false,
    secretExported: Boolean(options.secretOutput),
  };
  if (options.json) display.line(JSON.stringify(safe));
  else {
    logger.success(
      result.uploaded ? 'Encrypted short link created' : 'Private fragment link created',
    );
    display.keyValue('Transport', String(result.transport));
    if (prepared.bundle.remoteAssetCount) {
      display.keyValue('Remote assets', String(prepared.bundle.remoteAssetCount));
    }
    display.keyValue('Presentation', prepared.presentation);
    if (result.expiresAt) display.keyValue('Expires', String(result.expiresAt));
    display.keyValue('Private custody', options.secretOutput ? 'exported' : 'browser handoff only');
  }
}

function assertReviewEnvelope(value: ArtifactEnvelope, artifactId?: string): void {
  if (!value.review) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_REVIEW_IMPORT',
      'The supplied link contains an artifact but no returned review.',
    );
  }
  if (artifactId && value.viewer.activeArtifactId !== artifactId) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_REVIEW_IMPORT',
      'All imported review links must target the same artifact.',
    );
  }
}

async function importArtifactReviews(
  program: Command,
  positionalSources: string[] | undefined,
  options: ImportOptions,
): Promise<void> {
  const api = await loadArtifactPipeline();
  if ((positionalSources?.length ?? 0) > 0 || !options.secretInput) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_SECRET_INPUT',
      'Capability-bearing artifact URLs are not accepted in ordinary process arguments.',
      'Use `planr artifact import --secret-input <private-file|->`.',
    );
  }
  const inputPath =
    options.secretInput === '-' ? '-' : path.resolve(projectDir(program), options.secretInput);
  const secret = readArtifactSecretInput(inputPath);
  const sources = [secret.reviewUrl];
  const decoded = await Promise.all(
    sources.map(async (source) => {
      if (secret.transport === 'live-room') {
        if (typeof api.hydrateLiveReviewRoom !== 'function') {
          throw new ArtifactCommandError(
            'E_PIPELINE_VERSION_INCOMPATIBLE',
            'The installed planr-pipeline does not support live review import.',
          );
        }
        const room = await api.hydrateLiveReviewRoom(source);
        await verifyLiveRoomRecoveryCustody(
          api,
          secret,
          room as unknown as Record<string, unknown>,
        );
        if (room.protocolVersion === '1.0.0' && !options.json) {
          logger.warn('Imported a legacy unsigned room in permanent read-only compatibility mode.');
        }
        return { ...room.envelope, review: room.review };
      }
      return api.decodeReviewLink(source);
    }),
  );
  const artifactId = decoded[0]?.viewer.activeArtifactId;
  for (const envelope of decoded) assertReviewEnvelope(envelope, artifactId);
  const currentEnvelope = withoutArtifactReview(decoded[0]);
  const input = {
    sources: decoded,
    currentEnvelope,
    cwd: projectDir(program),
  };
  let result: Record<string, unknown>;
  try {
    result = await api.importArtifactReview({ ...input, allowStale: false, persist: true });
  } catch (error) {
    const value = error as {
      code?: string;
      details?: {
        localDigest?: string;
        reviewDigest?: string;
        pinCount?: number;
        replyCount?: number;
      };
    };
    if (value.code !== 'E_ARTIFACT_STALE_REVIEW' || !options.allowStale) throw error;
    const yes = confirmed(program, options.yes);
    if (!yes && isNonInteractive()) {
      throw new ArtifactCommandError(
        'E_ARTIFACT_CONFIRMATION_REQUIRED',
        'Importing stale artifact feedback requires explicit confirmation.',
        'Review the preview and rerun with `--allow-stale --yes`.',
      );
    }
    if (!options.json) {
      logger.warn(
        'The returned review targets an older artifact digest and will remain marked stale.',
      );
      if (value.details?.localDigest) display.keyValue('Current digest', value.details.localDigest);
      if (value.details?.reviewDigest)
        display.keyValue('Review digest', value.details.reviewDigest);
      display.keyValue('Pins', String(value.details?.pinCount ?? 0));
      display.keyValue('Replies', String(value.details?.replyCount ?? 0));
    }
    if (
      !yes &&
      !(await promptConfirm('Import this stale review without changing its digest?', false))
    ) {
      if (options.json) display.line(JSON.stringify({ ok: false, action: 'cancelled' }));
      return;
    }
    result = await api.importArtifactReview({ ...input, allowStale: true, persist: true });
  }
  if (options.output) {
    const output = path.resolve(projectDir(program), options.output);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(result.reviewState, null, 2)}\n`, { mode: 0o600 });
  }
  if (options.json) display.line(JSON.stringify(result));
  else {
    logger.success(
      `Imported ${String((result.imported as unknown[] | undefined)?.length ?? 0)} review(s)`,
    );
    display.keyValue('Artifact', String(result.artifactId));
    display.keyValue('Decision', String(result.effectiveDecision));
    display.keyValue(
      'Destination',
      String((result.destination as { kind?: string })?.kind ?? 'local'),
    );
    if (options.output)
      display.keyValue('Output', path.resolve(projectDir(program), options.output));
  }
}

async function runDesignSharing(
  program: Command,
  file: string,
  options: ShareOptions,
  action: 'share' | 'publish' | 'sync',
): Promise<void> {
  const input = resolveInput(program, file);
  if (!isDesignDocumentFile(input))
    throw new ArtifactCommandError(
      'E_ARTIFACT_INPUT_INVALID',
      'This operation requires a design-document.json file.',
    );
  if (action !== 'sync' && !confirmed(program, options.yes)) {
    if (isNonInteractive())
      throw new ArtifactCommandError(
        'E_ARTIFACT_CONFIRMATION_REQUIRED',
        'Publishing an encrypted design requires confirmation.',
        'Rerun with --yes.',
      );
    if (
      !(await promptConfirm(
        action === 'share'
          ? 'Publish an encrypted design review until you revoke or delete it?'
          : 'Publish this revision to the existing design review link?',
        true,
      ))
    )
      return;
  }
  const result = await runDesignShareAction(input, action);
  if (options.secretOutput)
    await runDesignShareAction(input, 'recovery', {
      output: path.resolve(projectDir(program), options.secretOutput),
    });
  if (options.json) display.line(JSON.stringify(result));
  else {
    logger.success(
      action === 'sync'
        ? 'Design feedback synchronized'
        : action === 'publish'
          ? 'Design revision published'
          : 'Design review shared',
    );
    if (result.url) display.keyValue('Review link', result.url);
    if (result.publishedRevision) display.keyValue('Revision', result.publishedRevision);
    if (result.reviewPath) display.keyValue('Feedback', result.reviewPath);
    if (action !== 'sync')
      logger.dim(
        'Owner credentials are saved privately. Open the local studio’s Share design dialog to copy the reviewer access token.',
      );
  }
  if (action === 'share' && options.open !== false && result.url) await openExternalUrl(result.url);
}

async function exportArtifactReview(
  program: Command,
  sessionId: string,
  options: { format?: string; output?: string },
): Promise<void> {
  const format = options.format ?? 'json';
  if (!['json', 'markdown'].includes(format)) {
    throw new ArtifactCommandError(
      'E_ARTIFACT_REVIEW_EXPORT',
      'Artifact review export format must be json or markdown.',
    );
  }
  const api = await loadArtifactPipeline();
  const result = await api.exportArtifactReviewSession(sessionId, {
    format: format as ExportFormat,
  });
  if (!options.output) {
    process.stdout.write(result.content);
    return;
  }
  const output = path.resolve(projectDir(program), options.output);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, result.content, { mode: 0o600 });
  logger.success(`Artifact review exported to ${output}`);
}

function addOpenOptions(command: Command): Command {
  return command
    .option('--title <title>', 'review title')
    .option('--root <asset-root>', 'root for local artifact dependencies')
    .option('--theme <theme>', 'auto, light, or dark', 'auto')
    .option('--presentation <presentation>', 'auto, document, or canvas', 'auto')
    .option('--port <port>', 'loopback review port')
    .option('--no-open', 'do not open a browser')
    .option('--json', 'emit machine-readable output', false);
}

export function registerArtifactCommand(program: Command): void {
  const artifact = addOpenOptions(
    program
      .command('artifact [file]')
      .description('Review, share, import, and export HTML artifacts'),
  );
  artifact.enablePositionalOptions();
  artifact.action(async (file: string | undefined, _options: OpenOptions, command: Command) => {
    if (!file) {
      artifact.help();
      return;
    }
    await openArtifact(program, file, command.optsWithGlobals<OpenOptions>());
  });

  addOpenOptions(
    artifact.command('open <file>').description('Open a local HTML review session'),
  ).action((file: string, _options: OpenOptions, command: Command) =>
    openArtifact(program, file, command.optsWithGlobals<OpenOptions>()),
  );

  artifact
    .command('handoff <file>')
    .description('Prepare a factual design review handoff for refinement and owner approval')
    .option('--json', 'emit machine-readable output', false)
    .action(async (file: string, _options, command: Command) => {
      const input = resolveInput(program, file);
      if (!isDesignDocumentFile(input))
        throw new ArtifactCommandError(
          'E_ARTIFACT_INPUT_INVALID',
          'Handoff requires a design-document.json file.',
        );
      const result = await prepareDesignHandoff(input);
      if (command.optsWithGlobals().json) display.line(JSON.stringify(result));
      else {
        logger.success('Design review handoff prepared');
        if (result.path) display.keyValue('Handoff', String(result.path));
        logger.dim(
          'Refine the draft in your coding session, then review and approve it in the local studio. Plan remains a separate invocation.',
        );
      }
    });

  artifact
    .command('share <file>')
    .description('Create an encrypted live review room')
    .option('--title <title>', 'review title')
    .option('--root <asset-root>', 'root for local artifact dependencies')
    .option('--presentation <presentation>', 'auto, document, or canvas', 'auto')
    .option('--short', 'create an encrypted expiring short link', false)
    .option('--snapshot', 'create an immutable snapshot instead of a live room', false)
    .option('--ttl <ttl>', 'generic artifact retention: 1d, 7d (default), or 30d')
    .option('--no-open', 'do not open the review link')
    .option('--json', 'emit machine-readable output', false)
    .option('--yes', 'confirm encrypted upload non-interactively', false)
    .option('--secret-output <path>', 'write capabilities to a new private 0600 file')
    .action((file: string, _options: ShareOptions, command: Command) =>
      shareArtifact(program, file, command.optsWithGlobals<ShareOptions>()),
    );

  for (const action of ['publish', 'sync'] as const) {
    artifact
      .command(`${action} <file>`)
      .description(
        action === 'publish'
          ? 'Publish a new revision to a shared design review'
          : 'Synchronize hosted design feedback',
      )
      .option('--yes', 'confirm encrypted publication non-interactively', false)
      .option('--json', 'emit machine-readable output', false)
      .action((file: string, _options: ShareOptions, command: Command) =>
        runDesignSharing(program, file, command.optsWithGlobals<ShareOptions>(), action),
      );
  }

  artifact
    .command('import [review-url...]')
    .description('Import one or more live-room or immutable review links')
    .option('--secret-input <path|->', 'read a private capability bundle from a 0600 file or stdin')
    .option('--output <path>', 'also write the merged review state to this path')
    .option('--allow-stale', 'preview and explicitly accept stale feedback', false)
    .option('--json', 'emit machine-readable output', false)
    .option('--yes', 'confirm stale import non-interactively', false)
    .action((sources: string[] | undefined, _options, command: Command) =>
      importArtifactReviews(program, sources, command.optsWithGlobals()),
    );

  artifact
    .command('export <session-id>')
    .description('Export feedback from a live local review session')
    .option('--format <format>', 'json or markdown', 'json')
    .option('--output <path>', 'write the export to a file')
    .action((sessionId: string, _options, command: Command) =>
      exportArtifactReview(program, sessionId, command.optsWithGlobals()),
    );
}
