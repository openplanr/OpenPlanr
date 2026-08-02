import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ArtifactCommandError, loadArtifactPipeline, openExternalUrl, prepareArtifactEnvelope, withoutArtifactReview, } from '../../services/artifact-pipeline-service.js';
import { isNonInteractive } from '../../services/interactive-state.js';
import { promptConfirm } from '../../services/prompt-service.js';
import { display, logger } from '../../utils/logger.js';
function projectDir(program) {
    return path.resolve(program.opts().projectDir);
}
function resolveInput(program, value) {
    return path.resolve(projectDir(program), value);
}
function resolveRoot(program, input, value) {
    return value === undefined ? path.dirname(input) : path.resolve(projectDir(program), value);
}
function theme(value) {
    if (value === undefined)
        return 'auto';
    if (['auto', 'light', 'dark'].includes(value))
        return value;
    throw new ArtifactCommandError('E_ARTIFACT_INPUT_INVALID', 'Artifact theme must be auto, light, or dark.');
}
function port(value) {
    if (value === undefined)
        return 0;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
        throw new ArtifactCommandError('E_ARTIFACT_INPUT_INVALID', 'Artifact review port must be an integer from 0 through 65535.');
    }
    return parsed;
}
function presentation(value) {
    if (value === undefined)
        return 'auto';
    if (['auto', 'document', 'canvas'].includes(value))
        return value;
    throw new ArtifactCommandError('E_ARTIFACT_INPUT_INVALID', 'Artifact presentation must be auto, document, or canvas.');
}
function confirmed(program, local) {
    return Boolean(local || program.opts().yes);
}
async function openArtifact(program, file, options) {
    const cwd = projectDir(program);
    const input = resolveInput(program, file);
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
async function shareArtifact(program, file, options) {
    if (options.short && !options.snapshot) {
        throw new ArtifactCommandError('E_ARTIFACT_INPUT_INVALID', '`--short` selects encrypted snapshot transport and requires `--snapshot`.', 'Use `planr artifact share <file> --snapshot --short --yes`, or omit both options to create a live room.');
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
        if (typeof prepared.api.createLiveReviewRoom !== 'function') {
            throw new ArtifactCommandError('E_PIPELINE_VERSION_INCOMPATIBLE', 'The installed planr-pipeline does not support encrypted live review rooms.', 'Run `npm install -g openplanr@latest` after the compatible pipeline release is available, or use `--snapshot`.');
        }
        let allowLive = yes;
        if (!allowLive) {
            if (isNonInteractive()) {
                throw new ArtifactCommandError('E_ARTIFACT_CONFIRMATION_REQUIRED', 'Live review rooms upload encrypted ciphertext and require explicit confirmation.', 'Rerun with `planr artifact share <file> --yes`.');
            }
            display.keyValue('Expiry', options.ttl ?? '7d');
            allowLive = await promptConfirm('Create an encrypted live review room? Anyone with the review link can comment; only you receive the manage link.', true);
        }
        if (!allowLive)
            return;
        const result = await prepared.api.createLiveReviewRoom(prepared.envelope, {
            baseUrl: process.env.OPENPLANR_SHARE_BASE ?? 'https://share.openplanr.dev',
            ttl: options.ttl ?? '7d',
        });
        const url = String(result.url);
        if (options.open !== false)
            await openExternalUrl(url);
        if (options.json) {
            display.line(JSON.stringify({ ...result, presentation: prepared.presentation }));
        }
        else {
            logger.success('Encrypted live review room created');
            display.keyValue('Review URL', url);
            display.keyValue('Manage URL', String(result.manageUrl));
            if (prepared.bundle.remoteAssetCount) {
                display.keyValue('Remote assets', String(prepared.bundle.remoteAssetCount));
            }
            display.keyValue('Presentation', prepared.presentation);
            if (result.expiresAt)
                display.keyValue('Expires', String(result.expiresAt));
            logger.warn('Save the manage URL privately. It can pause comments, set the final decision, or delete this room.');
        }
        return;
    }
    const preview = prepared.api.createReviewLinkPreview(prepared.envelope);
    if (!preview.fragmentEligible && isNonInteractive() && !(options.short && yes)) {
        throw new ArtifactCommandError('E_ARTIFACT_SHORT_CONFIRMATION_REQUIRED', 'This artifact is too large for a private fragment link.', 'Rerun with `planr artifact share <file> --short --yes` to upload encrypted ciphertext.');
    }
    const needsConsent = Boolean(options.short || !preview.fragmentEligible);
    let allowShort = yes;
    if (needsConsent && !allowShort) {
        if (isNonInteractive()) {
            throw new ArtifactCommandError('E_ARTIFACT_SHORT_CONFIRMATION_REQUIRED', 'Encrypted short-link creation requires explicit confirmation.', 'Rerun with `--short --yes`.');
        }
        display.keyValue('Encrypted size', `${preview.ciphertextBytes.toLocaleString()} bytes`);
        display.keyValue('Expiry', options.ttl ?? '7d');
        allowShort = await promptConfirm('Upload ciphertext to share.openplanr.dev? The decryption key remains in the URL fragment.', true);
    }
    const result = await prepared.api.createReviewLink(prepared.envelope, {
        baseUrl: process.env.OPENPLANR_SHARE_BASE ?? 'https://share.openplanr.dev',
        short: Boolean(options.short),
        transport: options.short ? 'short' : 'auto',
        ttl: options.ttl ?? '7d',
        confirmed: allowShort,
        yes: allowShort,
    });
    const url = String(result.url);
    if (options.open !== false)
        await openExternalUrl(url);
    if (options.json)
        display.line(JSON.stringify({ ...result, presentation: prepared.presentation }));
    else {
        logger.success(result.uploaded ? 'Encrypted short link created' : 'Private fragment link created');
        display.keyValue('URL', url);
        display.keyValue('Transport', String(result.transport));
        if (prepared.bundle.remoteAssetCount) {
            display.keyValue('Remote assets', String(prepared.bundle.remoteAssetCount));
        }
        display.keyValue('Presentation', prepared.presentation);
        if (result.expiresAt)
            display.keyValue('Expires', String(result.expiresAt));
        if (result.deletionToken) {
            display.keyValue('Deletion token', String(result.deletionToken));
            logger.warn('Save the deletion token now; it is shown only once and is not part of the review URL.');
        }
    }
}
function assertReviewEnvelope(value, artifactId) {
    if (!value.review) {
        throw new ArtifactCommandError('E_ARTIFACT_REVIEW_IMPORT', 'The supplied link contains an artifact but no returned review.');
    }
    if (artifactId && value.viewer.activeArtifactId !== artifactId) {
        throw new ArtifactCommandError('E_ARTIFACT_REVIEW_IMPORT', 'All imported review links must target the same artifact.');
    }
}
async function importArtifactReviews(program, sources, options) {
    const api = await loadArtifactPipeline();
    const decoded = await Promise.all(sources.map(async (source) => {
        if (/^https?:\/\/[^/]+\/r\/[A-Za-z0-9_-]{16,128}\/?#/u.test(source)) {
            if (typeof api.hydrateLiveReviewRoom !== 'function') {
                throw new ArtifactCommandError('E_PIPELINE_VERSION_INCOMPATIBLE', 'The installed planr-pipeline does not support live review import.');
            }
            const room = await api.hydrateLiveReviewRoom(source);
            return { ...room.envelope, review: room.review };
        }
        return api.decodeReviewLink(source);
    }));
    const artifactId = decoded[0]?.viewer.activeArtifactId;
    for (const envelope of decoded)
        assertReviewEnvelope(envelope, artifactId);
    const currentEnvelope = withoutArtifactReview(decoded[0]);
    const input = {
        sources: decoded,
        currentEnvelope,
        cwd: projectDir(program),
    };
    let result;
    try {
        result = await api.importArtifactReview({ ...input, allowStale: false, persist: true });
    }
    catch (error) {
        const value = error;
        if (value.code !== 'E_ARTIFACT_STALE_REVIEW' || !options.allowStale)
            throw error;
        const yes = confirmed(program, options.yes);
        if (!yes && isNonInteractive()) {
            throw new ArtifactCommandError('E_ARTIFACT_CONFIRMATION_REQUIRED', 'Importing stale artifact feedback requires explicit confirmation.', 'Review the preview and rerun with `--allow-stale --yes`.');
        }
        if (!options.json) {
            logger.warn('The returned review targets an older artifact digest and will remain marked stale.');
            if (value.details?.localDigest)
                display.keyValue('Current digest', value.details.localDigest);
            if (value.details?.reviewDigest)
                display.keyValue('Review digest', value.details.reviewDigest);
            display.keyValue('Pins', String(value.details?.pinCount ?? 0));
            display.keyValue('Replies', String(value.details?.replyCount ?? 0));
        }
        if (!yes &&
            !(await promptConfirm('Import this stale review without changing its digest?', false))) {
            if (options.json)
                display.line(JSON.stringify({ ok: false, action: 'cancelled' }));
            return;
        }
        result = await api.importArtifactReview({ ...input, allowStale: true, persist: true });
    }
    if (options.output) {
        const output = path.resolve(projectDir(program), options.output);
        mkdirSync(path.dirname(output), { recursive: true });
        writeFileSync(output, `${JSON.stringify(result.reviewState, null, 2)}\n`, { mode: 0o600 });
    }
    if (options.json)
        display.line(JSON.stringify(result));
    else {
        logger.success(`Imported ${String(result.imported?.length ?? 0)} review(s)`);
        display.keyValue('Artifact', String(result.artifactId));
        display.keyValue('Decision', String(result.effectiveDecision));
        display.keyValue('Destination', String(result.destination?.kind ?? 'local'));
        if (options.output)
            display.keyValue('Output', path.resolve(projectDir(program), options.output));
    }
}
async function exportArtifactReview(program, sessionId, options) {
    const format = options.format ?? 'json';
    if (!['json', 'markdown'].includes(format)) {
        throw new ArtifactCommandError('E_ARTIFACT_REVIEW_EXPORT', 'Artifact review export format must be json or markdown.');
    }
    const api = await loadArtifactPipeline();
    const result = await api.exportArtifactReviewSession(sessionId, {
        format: format,
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
function addOpenOptions(command) {
    return command
        .option('--title <title>', 'review title')
        .option('--root <asset-root>', 'root for local artifact dependencies')
        .option('--theme <theme>', 'auto, light, or dark', 'auto')
        .option('--presentation <presentation>', 'auto, document, or canvas', 'auto')
        .option('--port <port>', 'loopback review port')
        .option('--no-open', 'do not open a browser')
        .option('--json', 'emit machine-readable output', false);
}
export function registerArtifactCommand(program) {
    const artifact = addOpenOptions(program
        .command('artifact [file]')
        .description('Review, share, import, and export HTML artifacts'));
    artifact.enablePositionalOptions();
    artifact.action(async (file, _options, command) => {
        if (!file) {
            artifact.help();
            return;
        }
        await openArtifact(program, file, command.optsWithGlobals());
    });
    addOpenOptions(artifact.command('open <file>').description('Open a local HTML review session')).action((file, _options, command) => openArtifact(program, file, command.optsWithGlobals()));
    artifact
        .command('share <file>')
        .description('Create an encrypted live review room')
        .option('--title <title>', 'review title')
        .option('--root <asset-root>', 'root for local artifact dependencies')
        .option('--presentation <presentation>', 'auto, document, or canvas', 'auto')
        .option('--short', 'create an encrypted expiring short link', false)
        .option('--snapshot', 'create an immutable snapshot instead of a live room', false)
        .option('--ttl <ttl>', '1d, 7d, or 30d', '7d')
        .option('--no-open', 'do not open the review link')
        .option('--json', 'emit machine-readable output', false)
        .option('--yes', 'confirm encrypted upload non-interactively', false)
        .action((file, _options, command) => shareArtifact(program, file, command.optsWithGlobals()));
    artifact
        .command('import <review-url...>')
        .description('Import one or more live-room or immutable review links')
        .option('--output <path>', 'also write the merged review state to this path')
        .option('--allow-stale', 'preview and explicitly accept stale feedback', false)
        .option('--json', 'emit machine-readable output', false)
        .option('--yes', 'confirm stale import non-interactively', false)
        .action((sources, _options, command) => importArtifactReviews(program, sources, command.optsWithGlobals()));
    artifact
        .command('export <session-id>')
        .description('Export feedback from a live local review session')
        .option('--format <format>', 'json or markdown', 'json')
        .option('--output <path>', 'write the export to a file')
        .action((sessionId, _options, command) => exportArtifactReview(program, sessionId, command.optsWithGlobals()));
}
//# sourceMappingURL=artifact.js.map