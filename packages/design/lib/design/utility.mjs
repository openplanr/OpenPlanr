#!/usr/bin/env node
/** Deterministic support for host-authored design work. Never calls a model. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDesignDocument, prepareDesignDocument, renderDesignDocument, currentDesign, standaloneDesignHtml, atomicJson, readJson } from './document.mjs';
import { exportDesignReview, readDesignFeedback, resolveDesignPins, saveDesignState, startDesignReview } from './review.mjs';
import { shareDesign, publishDesignShare, syncDesignShare, manageDesignShare, exportDesignShareRecovery, importDesignShareRecovery } from './share.mjs';
import { readDesignHandoff, updateDesignHandoff } from './handoff.mjs';
import { serializeDesignReviewExport } from './review-export.mjs';
export { auditRenderedScreen, auditDesignPage } from './browser-audit.mjs';

function isPng(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8, header = false, pixels = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (length > bytes.length - offset - 12) return false;
    if (!header) {
      if (type !== 'IHDR' || length !== 13 || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) return false;
      header = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT' && length > 0) pixels = true;
    offset += length + 12;
    if (type === 'IEND') return length === 0 && pixels && offset === bytes.length;
  }
  return false;
}

export function verifyDesignDocument(file, report) {
  const current = currentDesign(file);
  if (!report || report.revision !== current.revision) throw new Error('Browser report belongs to a different render revision.');
  const screenEvidence = Array.isArray(report.screens) ? report.screens : [];
  const checkedArtifacts = Array.isArray(report.checkedArtifacts) ? report.checkedArtifacts : [];
  const coverage = current.entries.every((entry) => {
    const frame = current.document.frames.find((item) => item.id === entry.frameId);
    const matches = screenEvidence.filter((item) => item?.artifactId === entry.artifactId);
    return checkedArtifacts.includes(entry.artifactId) && matches.length === 1 && matches[0].screenId === entry.screenId
      && matches[0].viewport?.width === frame.width && matches[0].viewport?.height === frame.height
      && Number.isInteger(matches[0].checkedElements) && matches[0].checkedElements > 0;
  });
  const images = (Array.isArray(report.screenshots) ? report.screenshots : []).filter((item) => {
    const path = typeof item === 'string' ? item : item?.path;
    try { return typeof path === 'string' && isPng(readFileSync(resolve(path))); } catch { return false; }
  });
  const journeys = Array.isArray(report.scenarios) && report.scenarios.length > 0
    && report.scenarios.every((item) => item?.status === 'passed' && [item.name, item.id].some((value) => typeof value === 'string' && value.trim().length > 0));
  const issues = [...(Array.isArray(report.issues) ? report.issues : []), ...screenEvidence.flatMap((item) => Array.isArray(item?.issues) ? item.issues : [])];
  const status = issues.some((item) => item?.severity === 'error') || report.status === 'failed' ? 'failed'
    : coverage && images.length > 0 && journeys && report.status !== 'unverified' ? 'verified' : 'unverified';
  const saved = { ...report, issues, schemaVersion: '1.0.0', revision: current.revision, status, checkedAt: new Date().toISOString(), coverage, screenshotCount: images.length, primaryJourneysChecked: Boolean(journeys) };
  atomicJson(join(current.root, '.design/verification', `${current.revision}.json`), saved);
  return saved;
}

export async function designUtility(argv, { stdout = (value) => process.stdout.write(`${JSON.stringify(value)}\n`), openUrl, env = process.env, fetchImpl = fetch } = {}) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help') {
    const help = { usage: 'design.mjs inspect|validate|render|open|export|feedback|verify|share|publish|sync|manage|handoff <design-document.json>', flags: ['--json', '--no-open', '--view canvas|prototype|walkthrough', '--port <number>', '--format html|json|markdown', '--scope current|all', '--output <path>', '--report <browser-report.json>', '--action inspect|export|select|resolve|rotate|pause|resume|revoke|delete|recovery|restore', '--input <private recovery file>', '--variant <id>', '--pins <id,id>', '--summary <text>'], note: 'The host authors design sources. This utility only validates, renders, reviews and exports them.' }; stdout(help); return help;
  }
  const [command, input, ...args] = argv;
  if (!['inspect', 'validate', 'render', 'open', 'export', 'feedback', 'verify', 'share', 'publish', 'sync', 'manage', 'handoff'].includes(command) || !input) throw new Error('Usage: design.mjs inspect|validate|render|open|export|feedback|verify|share|publish|sync|manage|handoff <design-document.json> [--json] [--no-open] [--view canvas|prototype|walkthrough]');
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`Unexpected argument: ${args[i]}`);
    const key = args[i].slice(2);
    if (!['json', 'no-open', 'view', 'format', 'output', 'port', 'report', 'action', 'pins', 'summary', 'variant', 'input', 'scope'].includes(key)) throw new Error(`Unknown option: ${args[i]}`);
    flags[key] = ['json', 'no-open'].includes(key) ? true : args[++i];
  }
  if (flags.view && !['canvas', 'prototype', 'walkthrough'].includes(flags.view)) throw new Error('View must be canvas, prototype, or walkthrough.');
  const file = resolve(input);
  let result;
  if (command === 'handoff') {
    const action = flags.action ?? 'inspect';
    if (action === 'inspect') result = readDesignHandoff(file);
    else {
      const snapshot = readDesignHandoff(file);
      const input = flags.input ? readJson(resolve(flags.input)) : {};
      result = await updateDesignHandoff(file, { ...input, action, revision: input.revision ?? snapshot.revision, version: input.version ?? (snapshot.draft?.version ?? 0) });
    }
  }
  if (command === 'share') result = await shareDesign(file);
  if (command === 'publish') result = await publishDesignShare(file);
  if (command === 'sync') result = await syncDesignShare(file);
  if (command === 'manage' && !['rotate', 'pause', 'resume', 'revoke', 'delete', 'recovery', 'restore'].includes(flags.action)) throw new Error('manage requires --action rotate|pause|resume|revoke|delete|recovery|restore.');
  if (command === 'manage') result = flags.action === 'restore' ? await importDesignShareRecovery(file, { input: flags.input }) : flags.action === 'recovery' ? await exportDesignShareRecovery(file, { output: flags.output }) : await manageDesignShare(file, flags.action);
  if (command === 'inspect') result = inspectDesignDocument(file);
  if (command === 'validate') {
    const prepared = prepareDesignDocument(file);
    result = { ok: prepared.lint.every((item) => item.ok), lint: prepared.lint, screens: prepared.document.screens.length, artifacts: prepared.entries.length, verification: 'unverified' };
  }
  if (command === 'render') result = await renderDesignDocument(file);
  if (command === 'open') {
    const port = flags.port === undefined ? 0 : Number(flags.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535.');
    result = await startDesignReview(file, { port, view: flags.view, noOpen: Boolean(flags['no-open']), openUrl });
    const close = result.close;
    if (close) { process.once('SIGINT', async () => { await close(); process.exit(0); }); process.once('SIGTERM', async () => { await close(); process.exit(0); }); }
  }
  if (command === 'export') {
    const current = currentDesign(file), view = flags.view ?? current.document.defaultView;
    const state = readJson(join(current.root, '.design/studio-state.json'), { state: {} }).state;
    if (flags.format && flags.format !== 'html') throw new Error('Portable export supports HTML. Use the studio PNG action for browser-rendered captures.');
    const output = resolve(flags.output ?? join(current.root, `${view}-export.html`));
    if (existsSync(output)) throw new Error(`Export already exists: ${output}. Choose a new --output path.`);
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, standaloneDesignHtml({ ...current, state }, view), { flag: 'wx' });
    result = { ok: true, output, view, revision: current.revision };
  }
  if (command === 'verify') {
    if (!flags.report) throw new Error('verify requires --report <browser-report.json>.');
    result = verifyDesignDocument(file, readJson(resolve(flags.report)));
  }
  if (command === 'feedback') {
    await syncDesignShare(file, { env, fetchImpl });
    const action = flags.action ?? 'inspect';
    if (action === 'inspect') result = readDesignFeedback(file, env);
    else if (action === 'export') {
      const format = flags.format ?? 'json', scope = flags.scope ?? 'all';
      if (!['json', 'markdown'].includes(format)) throw new Error('Feedback export format must be json or markdown.');
      if (!['current', 'all'].includes(scope)) throw new Error('Feedback export scope must be current or all.');
      if (!flags.output) throw new Error('Feedback export requires --output <path>.');
      const output = resolve(flags.output);
      if (existsSync(output)) throw new Error('Feedback export already exists. Choose a new --output path.');
      const snapshot = exportDesignReview(file, { scope, env });
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, serializeDesignReviewExport(snapshot, format), { flag: 'wx', mode: 0o600 });
      result = { ok: true, output, format, scope, revision: snapshot.currentRevisionId, summary: snapshot.summary };
    }
    else if (action === 'resolve') result = await resolveDesignPins(file, { pinIds: flags.pins?.split(',').filter(Boolean), summary: flags.summary, env });
    else if (action === 'select') {
      const current = currentDesign(file), saved = readJson(join(current.root, '.design/studio-state.json'), { state: {}, stateVersion: 0 });
      const variant = flags.variant ?? saved.state.selectedVariant;
      if (!current.document.variants.some((item) => item.id === variant && item.status === 'ready')) throw new Error('Select a ready variant with --variant.');
      const selected = [variant], rejected = (saved.state.preferences?.rejected ?? []).filter((id) => id !== variant);
      result = await saveDesignState(file, { ...saved, revision: current.revision, state: { ...saved.state, selectedVariant: variant, preferences: { selected, rejected } } });
      result = { ok: true, selectedVariant: variant, tastePath: result.tastePath, revision: current.revision };
    } else throw new Error('Feedback action must be inspect, export, select, or resolve.');
  }
  stdout(result);
  return result;
}

const main = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (main) designUtility(process.argv.slice(2), { openUrl: async (url) => {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const child = spawn(command, [url], { stdio: 'ignore' }); child.on('error', () => {}); child.unref();
} }).then((result) => { if (result?.ok === false || result?.status === 'failed') process.exitCode = 1; }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
