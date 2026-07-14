#!/usr/bin/env node
/**
 * planr-design — the design-loop engine CLI (vendored in the plugin, zero deps).
 *
 *   setup     store a provider key (0600) + REAL smoke test with printed proof
 *   doctor    auth + daemon + a $0 dry-run (claude-svg contract validation)
 *   generate  one variant (openai: image → tmp → cp; claude-svg: prints the contract)
 *   variants  N sequential variants (the agents run parallel `generate`s instead)
 *   evolve    variants FROM an existing image ("I don't like THIS")
 *   iterate   continue a session chain with feedback text (refine, not regenerate)
 *   check     quality-gate an artifact against its brief / sheet contract
 *   daemon    --status (is a board daemon up?) | --serve (reuse or run it; for a background task)
 *   board     write board.html, ensure the daemon, register, print BOARD_URL on stderr
 *   feedback  resolve --dir <dir> --id <slug> (--pins <id,…> | --all-open) — mark pins resolved
 *   taste     read | approved <artifact> | rejected <artifact> (updates the profile)
 *
 * Outputs one JSON result line on stdout per command (agent-parseable); humans
 * get the same JSON pretty-printed. Keys are NEVER echoed (hard rule 7).
 */

import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { resolveAuth } from './auth.mjs';
import { credentialsPath, planrHome, projectDesignsDir, sessionDirName, tasteProfilePath, ARTIFACT_GITIGNORE } from './paths.mjs';
import { resolveProvider } from './providers/index.mjs';
import * as openai from './providers/openai.mjs';
import { sheetContract, contractInstructions, validateSheet } from './providers/claudeSvg.mjs';
import { createSession, loadSession, saveSession, appendRound } from './session.mjs';
import {
  DESIGN_BOARD_ENVELOPE_FILE,
  DESIGN_BOARD_SOURCES_FILE,
  renderBoardHtml,
} from './board.mjs';
import { createDesignBoardArtifactEnvelope } from './artifact-adapter.mjs';
import { findRunningDaemon, DAEMON_VERSION, createDaemon, killRunningDaemon } from './daemon.mjs';
import { publicBoardId } from './board-token.mjs';
import { loadProfile, saveProfile, updateTaste, detectConflicts } from './taste.mjs';
import { imageDimensions, buildImageCanvasData, wrapInCanvas, discoverVariants } from './canvas-wrap.mjs';
import { parseArgs } from '../design/cli-parser.mjs';

const here = fileURLToPath(import.meta.url);
// templates/design lives at the plugin root (cli.mjs is at lib/design-engine/).
const TEMPLATES_DIR = join(dirname(here), '..', '..', 'templates', 'design');
// The three vendored runtime files a DesignCanvas needs at view time.
const CANVAS_VENDOR = ['react.production.min.js', 'react-dom.production.min.js', 'DesignCanvas.js'];

/**
 * Render a loop variant image (svg/png) into the same DesignCanvas the review
 * board uses: write a sibling `variant-{X}.html` next to the image and copy the
 * vendor runtime into the session dir (idempotent). The board's `type:'html'`
 * path then shows the variant as a real pan/zoom canvas. Best-effort — a failure
 * leaves the bare image in place so the board still falls back to image/svg.
 *
 * @param {string} sessionDir
 * @param {string} variantId   the variant letter (also the canvas slot id)
 * @param {string} imageFile   basename of the variant image in sessionDir
 * @param {string} [label]
 */
function materializeCanvasArtifact(sessionDir, variantId, imageFile, label) {
  try {
    const shellHtml = readFileSync(join(TEMPLATES_DIR, 'canvas-shell.html'), 'utf8');
    const dims = imageDimensions(join(sessionDir, imageFile));
    const data = buildImageCanvasData({ variantId, label, src: imageFile, width: dims.width, height: dims.height });
    writeFileSync(join(sessionDir, `variant-${variantId}.html`), wrapInCanvas({ shellHtml, data, title: label }));
    const vendorDir = join(sessionDir, 'vendor');
    mkdirSync(vendorDir, { recursive: true });
    for (const f of CANVAS_VENDOR) {
      const dest = join(vendorDir, f);
      if (!existsSync(dest)) copyFileSync(join(TEMPLATES_DIR, 'vendor', f), dest);
    }
  } catch (e) {
    errLine(`⚠ canvas wrap skipped for variant ${variantId} (${e.message}) — board shows the bare image`);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const out = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
const errLine = (s) => process.stderr.write(`${s}\n`);
const fail = (msg, code = 1) => { errLine(`✗ ${msg}`); process.exit(code); };

function ensureArtifactDir(dir) {
  mkdirSync(dir, { recursive: true });
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, ARTIFACT_GITIGNORE); // hard rule 13
  return dir;
}

function resolveSessionDir(args) {
  if (args['session-dir']) return ensureArtifactDir(resolve(args['session-dir']));
  const project = args.project || 'default';
  const target = args.target || 'design';
  return ensureArtifactDir(join(projectDesignsDir(project), sessionDirName(target)));
}

async function promptHidden(question) {
  return new Promise((resolveAns) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    // mute echo: readline writes the prompt; we swallow the keystrokes' rendering
    const onData = () => {};
    process.stdin.on('data', onData);
    rl.question(`${question} `, (ans) => {
      process.stdin.off('data', onData);
      rl.close();
      errLine(''); // newline after hidden input
      resolveAns(ans.trim());
    });
    rl._writeToOutput = () => {}; // do not echo the key
    process.stderr.write(`${question} `);
  });
}

// ── commands ────────────────────────────────────────────────────────────────

async function cmdSetup(args) {
  const key = args.key ? String(args.key) : await promptHidden('Paste your OpenAI API key (input hidden):');
  if (!key || !key.startsWith('sk-')) fail('that does not look like an OpenAI key (sk-…)');

  const credsFile = credentialsPath();
  mkdirSync(planrHome(), { recursive: true });
  let creds = {};
  if (existsSync(credsFile)) { try { creds = JSON.parse(readFileSync(credsFile, 'utf-8')); } catch { creds = {}; } }
  creds.openai_api_key = key;
  writeFileSync(credsFile, `${JSON.stringify(creds, null, 2)}\n`);
  chmodSync(credsFile, 0o600);
  errLine(`✓ key stored in ${credsFile} (0600). It will never be echoed.`);

  if (args['no-smoke']) { out({ ok: true, stored: true, smoke: 'skipped' }); return; }

  errLine('Running a real smoke generation (one small image) so you see it work before any real spend…');
  const t0 = Date.now();
  const smokeDir = ensureArtifactDir(join(projectDesignsDir('_smoke'), sessionDirName('smoke')));
  const { imagePath, responseId, bytes } = await openai.generateVariant(
    'A tiny abstract geometric mark, two shapes, flat indigo on cream. Minimal.',
    { apiKey: key, size: '1024x1024', quality: 'low' },
  );
  const outputPath = join(smokeDir, 'smoke.png');
  copyFileSync(imagePath, outputPath); // tmp → final (hard rule 5)
  let session = createSession({ id: 'smoke', provider: 'openai', target: 'smoke', brief: 'smoke test' });
  session = appendRound(session, { outputPath, responseId });
  saveSession(smokeDir, 'smoke', session);
  const proof = {
    outputPath,
    sessionFile: join(smokeDir, 'session-smoke.json'),
    responseId,
    elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    bytes,
  };
  out({ ok: true, smoke: 'PASSED', proof });
  errLine('✓ Smoke test PASSED');
}

async function cmdDoctor(args) {
  const auth = resolveAuth({ cwd: process.cwd() });
  for (const w of auth.warnings) errLine(`⚠ ${w}`);
  const daemon = await findRunningDaemon();
  // $0 dry-run: validate a known-good sheet against the logo contract — proves
  // the claude-svg pipeline end-to-end with zero network and zero spend.
  const contract = sheetContract('logo');
  const sample = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${contract.width}" height="${contract.height}" viewBox="0 0 ${contract.width} ${contract.height}">`,
    '<g id="tile-light"><g id="section-mark"><circle cx="100" cy="100" r="40"/></g>',
    '<g id="section-wordmark"><text x="200" y="110" font-family="system-ui" font-size="48">planr</text></g>',
    '<g id="section-lockup"><text x="200" y="200" font-family="system-ui" font-size="24">planr · mark</text></g></g>',
    '<g id="tile-dark"><rect width="100" height="100" fill="#111"/><text x="10" y="60" fill="#fff" font-family="system-ui">planr</text></g>',
    '</svg>',
  ].join('');
  const dryRun = validateSheet(sample, contract);
  const report = {
    ok: true,
    auth: { source: auth.source, hasKey: Boolean(auth.apiKey), warnings: auth.warnings },
    providers: { openai: Boolean(auth.apiKey), 'claude-svg': true },
    daemon: daemon ? { running: true, port: daemon.port } : { running: false },
    dryRun: { provider: 'claude-svg', pass: dryRun.pass, issues: dryRun.issues, cost: '$0' },
    home: planrHome(),
  };
  if (args.json) process.stdout.write(`${JSON.stringify(report)}\n`); else out(report);
}

async function cmdGenerate(args) {
  const brief = args.brief || fail('--brief required');
  const variant = String(args.variant || 'A');
  const target = args.target || 'design';
  const sessionDir = resolveSessionDir(args);
  const auth = resolveAuth({ cwd: process.cwd() });
  for (const w of auth.warnings) errLine(`⚠ ${w}`);
  const { name, provider, degraded, reason } = resolveProvider({ requested: args.provider || 'auto', auth });
  if (degraded) errLine(`provider: ${name} (${reason})`);

  if (name === 'claude-svg') {
    // The CLI defines the contract; the CALLING AGENT authors the SVG and then
    // runs `check`. Print the contract + exact output path — never a dead-end.
    const contract = sheetContract(target);
    out({
      ok: true,
      provider: name,
      action: 'author',
      variant,
      sessionDir,
      writeTo: join(sessionDir, `variant-${variant}.svg`),
      contract,
      instructions: contractInstructions(contract),
    });
    return;
  }

  const t0 = Date.now();
  const { imagePath, responseId, bytes } = await provider.generateVariant(brief, {
    apiKey: auth.apiKey,
    size: args.size || '1024x1024',
    quality: args.quality || 'high',
    imageInputPath: args['from-image'] || null,
  });
  const outputPath = join(sessionDir, `variant-${variant}.png`);
  copyFileSync(imagePath, outputPath); // tmp → final (hard rule 5)
  // render the variant onto the real DesignCanvas (board shows it pannable)
  materializeCanvasArtifact(sessionDir, variant, `variant-${variant}.png`, target);

  let session = loadSession(sessionDir, variant)
    ?? createSession({ id: `${basename(sessionDir)}-${variant}`, provider: name, target, project: args.project || '', brief });
  session = appendRound(session, { outputPath, responseId, brief });
  saveSession(sessionDir, variant, session);

  out({ ok: true, provider: name, variant, outputPath, responseId, bytes, elapsed: `${((Date.now() - t0) / 1000).toFixed(1)}s` });
}

async function cmdVariants(args) {
  const count = Math.max(1, Math.min(8, Number(args.count || 4)));
  const letters = 'ABCDEFGH'.slice(0, count).split('');
  const results = [];
  for (const variant of letters) {
    try {
      await cmdGenerate({ ...args, variant });
      results.push({ variant, ok: true });
    } catch (e) {
      results.push({ variant, ok: false, error: e.message, rateLimited: e.code === 'RATE_LIMITED' });
    }
  }
  out({ ok: results.every((r) => r.ok), results });
}

async function cmdEvolve(args) {
  if (!args.from) fail('--from <imagePath> required (the design you want variants OF)');
  return cmdGenerate({ ...args, 'from-image': args.from });
}

async function cmdIterate(args) {
  const variant = String(args.variant || 'A');
  const feedback = args.feedback || fail('--feedback required');
  const sessionDir = resolveSessionDir(args);
  const session = loadSession(sessionDir, variant) ?? fail(`no session-${variant}.json in ${sessionDir}`);
  const auth = resolveAuth({ cwd: process.cwd() });

  if (session.provider === 'claude-svg') {
    // The agent edits the SVG itself; the engine records the round for lineage.
    const current = session.outputPaths[session.outputPaths.length - 1];
    out({
      ok: true,
      provider: 'claude-svg',
      action: 'edit',
      variant,
      editFile: current,
      feedback,
      note: 'apply the feedback by editing the SVG in place (or write a -vN sibling), then run: planr-design check + record',
    });
    return;
  }

  if (!auth.apiKey) fail('iterate on an openai session needs the API key that created it');
  const { imagePath, responseId, bytes } = await openai.iterate(session, feedback, { apiKey: auth.apiKey });
  const round = session.outputPaths.length + 1;
  const outputPath = join(sessionDir, `variant-${variant}-v${round}.png`);
  copyFileSync(imagePath, outputPath);
  const next = appendRound(session, { outputPath, responseId, feedback });
  saveSession(sessionDir, variant, next);
  out({ ok: true, provider: 'openai', variant, round, outputPath, responseId, bytes });
}

/**
 * Record a claude-svg round: the AGENT authored/edited the artifact; this
 * persists the session lineage (create on first round, append after).
 */
async function cmdRecord(args) {
  const variant = String(args.variant || 'A');
  const file = args.file || fail('--file required (the artifact the agent wrote)');
  if (!existsSync(file)) fail(`artifact not found: ${file}`);
  const sessionDir = resolveSessionDir(args);
  const brief = args.brief || '';
  let session = loadSession(sessionDir, variant);
  if (!session) {
    if (!brief) fail('--brief required on the first record for a variant');
    session = createSession({
      id: `${basename(sessionDir)}-${variant}`,
      provider: 'claude-svg',
      target: args.target || 'design',
      project: args.project || '',
      brief,
    });
  }
  session = appendRound(session, {
    outputPath: resolve(file),
    responseId: null,
    feedback: args.feedback || undefined,
    brief: brief || undefined,
  });
  saveSession(sessionDir, variant, session);
  // (re)render the variant onto the real DesignCanvas so the board shows it pannable.
  // The board's stage shows the canonical `variant-{X}.svg` (edited in place on iterate);
  // re-wrap it so the canvas reflects the latest round.
  const mainImage = [`variant-${variant}.svg`, `variant-${variant}.png`].find((f) => existsSync(join(sessionDir, f)))
    || basename(resolve(file));
  materializeCanvasArtifact(sessionDir, variant, mainImage, session.target);
  out({ ok: true, provider: 'claude-svg', variant, rounds: session.outputPaths.length, sessionFile: join(sessionDir, `session-${variant}.json`) });
}

async function cmdCheck(args) {
  const file = args.file || fail('--file required');
  const target = args.target || 'design';
  if (file.endsWith('.svg')) {
    const verdict = validateSheet(readFileSync(file, 'utf-8'), sheetContract(target));
    out({ ok: true, provider: 'claude-svg', ...verdict });
    process.exitCode = verdict.pass ? 0 : 2;
    return;
  }
  const brief = args.brief || fail('--brief required for image checks');
  const auth = resolveAuth({ cwd: process.cwd() });
  if (!auth.apiKey) fail('image quality check needs an OpenAI key (svg checks are $0)');
  const verdict = await openai.checkQuality(file, brief, { apiKey: auth.apiKey });
  out({ ok: true, provider: 'openai', ...verdict });
  process.exitCode = verdict.pass ? 0 : 2;
}

async function ensureDaemon() {
  const running = await findRunningDaemon();
  if (running && running.version === DAEMON_VERSION) return running.port;
  // A daemon is already running but on stale code (older/absent version) — e.g.
  // it predates the non-enumerating index. Reusing it would keep serving the old
  // behaviour, so stop it and spawn a fresh one. (Rule 14 still holds: the daemon
  // outlives the agent; we only recycle it across a version change.)
  await killRunningDaemon(running);
  const daemonPath = join(here, '..', 'daemon.mjs');
  const child = spawn(process.execPath, [daemonPath, '--serve'], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolvePort, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('daemon did not start within 5s')), 5000);
    child.stderr.on('data', (c) => {
      buf += c;
      const m = buf.match(/DAEMON_PORT: (\d+)/);
      if (m) { clearTimeout(timer); resolvePort(Number(m[1])); }
    });
  });
  child.stderr.destroy();
  child.unref(); // daemon outlives the agent (hard rule 14)
  return port;
}

// `daemon` — manage the long-running board daemon directly. In a sandboxed agent runtime a
// detached child is reaped when the launching command exits, so the daemon can't ride on the
// short-lived `board` command: run `daemon --serve` as a tracked BACKGROUND task (it IS the
// daemon — the listening server keeps the process alive), then `board` reuses it. `--status`
// reports whether one is already running so the caller can skip the launch.
async function cmdDaemon(args) {
  const running = await findRunningDaemon();
  if (args.status) {
    out({
      ok: true,
      running: Boolean(running),
      port: running ? running.port : null,
      pid: running ? running.pid : null,
      version: running ? running.version : null,
      current: Boolean(running) && running.version === DAEMON_VERSION,
    });
    return;
  }
  // --serve (default): reuse a healthy, current-version daemon; otherwise boot one and stay up.
  if (running && running.version === DAEMON_VERSION) {
    errLine(`DAEMON_PORT: ${running.port}`); // the agent parses this exact line
    out({ ok: true, reused: true, port: running.port });
    return;
  }
  await killRunningDaemon(running);
  const port = await createDaemon().listen();
  // The listening server keeps this process alive — run it as a background task so the board
  // outlives the short-lived `board` call. The agent parses this exact line for the port.
  errLine(`DAEMON_PORT: ${port}`);
}

async function cmdBoard(args) {
  const dir = resolve(args.dir || resolveSessionDir(args));
  const slug = String(args.id || basename(dir));
  // Capability URL: the board id carries an unguessable token, so the review URL
  // is the credential — no other project's board is reachable or enumerable.
  const id = publicBoardId(slug, dir);
  const mode = args.mode === 'review' ? 'review' : 'loop';
  const title = args.title || `planr design — ${slug}`;

  let variants;
  if (args.variants) {
    variants = JSON.parse(args.variants);
  } else if (mode === 'review') {
    const artifact = ['finalized.html', 'canvas.html'].find((f) => existsSync(join(dir, f)))
      ?? fail(`no finalized.html / canvas.html in ${dir}`);
    variants = [{ id: 'artifact', label: artifact, src: artifact, type: 'html' }];
  } else {
    // One stage artifact per variant letter, preferring the canvas wrapper
    // (variant-X.html) over the bare image so the board shows each variant
    // pannable — degrading to the source image for legacy sessions.
    variants = discoverVariants(readdirSync(dir));
    if (variants.length === 0) fail(`no variant-*.{png,svg,html} files in ${dir}`);
  }

  let feedback;
  const feedbackPath = join(dir, 'feedback.json');
  if (existsSync(feedbackPath)) {
    try { feedback = JSON.parse(readFileSync(feedbackPath, 'utf8')); } catch { /* daemon exposes the invalid record */ }
  }
  const envelope = await createDesignBoardArtifactEnvelope({
    sessionDir: dir,
    mode,
    variants,
    title,
    feedback,
  });
  writeFileSync(join(dir, DESIGN_BOARD_ENVELOPE_FILE), `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  const sources = variants.map((variant) => {
    const direct = /\.(?:svg|png)$/i.test(variant.src) ? variant.src : null;
    const original = direct ?? [
      `variant-${variant.id}.svg`,
      `variant-${variant.id}.png`,
    ].find((name) => existsSync(join(dir, name))) ?? variant.src;
    return {
      artifactId: variant.id,
      src: original,
      kind: /\.svg$/i.test(original) ? 'svg' : /\.png$/i.test(original) ? 'png' : 'html',
    };
  });
  writeFileSync(
    join(dir, DESIGN_BOARD_SOURCES_FILE),
    `${JSON.stringify({ schemaVersion: '1.0.0', sources }, null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(join(dir, 'board.html'), renderBoardHtml({ boardId: id, title, mode, variants, envelope }));
  const port = await ensureDaemon();
  const reg = await fetch(`http://127.0.0.1:${port}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, dir }),
  }).then((r) => r.json());
  if (reg.error) fail(`daemon refused the board: ${reg.error}`);

  const url = `http://127.0.0.1:${port}/boards/${encodeURIComponent(id)}/`;
  errLine(`BOARD_URL: ${url}`); // the agent parses this exact line
  out({ ok: true, boardId: id, dir, port, url, mode, variants: variants.map((v) => v.id) });
}

// `feedback resolve` — mark review pins resolved from the agent side, after it has addressed
// them. A thin client of the running daemon (the same path the board's Resolve button uses): GET
// the durable record (so each pin's id + author — the merge key — are exact), flip status to
// "resolved" on the targeted pins, and POST one merge contribution. The daemon merges under its
// per-board mutex, writes feedback.json, and broadcasts feedback:update so any open tab flips the
// marker + rail chip live. Resolve is a TEAM action (not author-scoped), so the agent can resolve
// a reviewer's pin. Run it right after the round (before further edits) to keep the GET→POST
// window tiny.
async function cmdFeedback(args) {
  const sub = args._[1];
  if (sub !== 'resolve') fail(`unknown feedback subcommand "${sub || ''}" (expected: resolve)`);

  const dir = resolve(args.dir || fail('feedback resolve: --dir <board dir> required'));
  const slug = String(args.id || basename(dir));
  const id = publicBoardId(slug, dir); // reuses the board's existing capability token

  const targeted = typeof args.pins === 'string'
    ? args.pins.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const allOpen = Boolean(args['all-open']);
  if (targeted && allOpen) fail('feedback resolve: pass --pins OR --all-open, not both');
  if (!targeted && !allOpen) fail('feedback resolve: pass --pins <id,…> or --all-open');

  const running = await findRunningDaemon();
  if (!running) {
    fail('feedback resolve: no board daemon running — start one (`cli.mjs daemon --serve`) and re-serve the board first');
  }
  const base = `http://127.0.0.1:${running.port}/boards/${encodeURIComponent(id)}/api/feedback`;

  // GET the durable record so id + author (the merge key) come straight from the store.
  const stored = await fetch(base).then((r) => r.json()).catch(() => null);
  if (!stored) fail(`feedback resolve: could not read feedback for board "${id}" (is it registered?)`);
  const pins = Array.isArray(stored.pins) ? stored.pins : [];

  const candidates = targeted ? pins.filter((p) => targeted.includes(p.id)) : pins;
  const found = new Set(candidates.map((p) => p.id));
  const missing = targeted ? targeted.filter((pid) => !found.has(pid)) : [];
  const toResolve = candidates.filter((p) => p.status !== 'resolved');
  const alreadyResolved = candidates.filter((p) => p.status === 'resolved').map((p) => p.id);

  if (toResolve.length) {
    const authors = [...new Set(toResolve.map((p) => p.author).filter(Boolean))].map((name) => ({ name }));
    const contribution = {
      schema_version: '1.0.0',
      boardId: id,
      publishedAt: new Date().toISOString(),
      regenerated: false,
      ratings: {},
      comments: {},
      authors,
      pins: toResolve.map((p) => ({ ...p, status: 'resolved' })), // full item — preserves the (id+author) key
    };
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'submit', feedback: contribution }),
    }).then((r) => r.json().then((b) => ({ ok: r.ok, error: b && b.error })))
      .catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    if (!res.ok || res.error) fail(`feedback resolve: daemon rejected the update — ${res.error || 'request failed'}`);
  }

  out({ ok: true, boardId: id, resolved: toResolve.map((p) => p.id), alreadyResolved, missing });
}

async function cmdTaste(args) {
  const sub = args._[1] || 'read';
  const project = args.project || 'default';
  const path = tasteProfilePath(project);

  if (sub === 'read') {
    const profile = loadProfile(path);
    const conflicts = args.brief
      ? detectConflicts(profile, {
          fonts: (args.fonts || '').split(',').filter(Boolean),
          colors: (args.colors || '').split(',').filter(Boolean),
          layouts: (args.layouts || '').split(',').filter(Boolean),
          aesthetics: (args.aesthetics || '').split(',').filter(Boolean),
        })
      : [];
    out({ ok: true, path, profile, conflicts });
    return;
  }

  if (sub === 'approved' || sub === 'rejected') {
    const artifact = args._[2] || fail(`usage: taste ${sub} <artifact> --project <p> [--fonts a,b …]`);
    let attributes = {
      fonts: (args.fonts || '').split(',').filter(Boolean),
      colors: (args.colors || '').split(',').filter(Boolean),
      layouts: (args.layouts || '').split(',').filter(Boolean),
      aesthetics: (args.aesthetics || '').split(',').filter(Boolean),
    };
    const flagged = Object.values(attributes).some((a) => a.length > 0);
    if (!flagged && artifact.endsWith('.png')) {
      const auth = resolveAuth({ cwd: process.cwd() });
      if (auth.apiKey) {
        errLine('no attribute flags — vision-extracting from the PNG…');
        attributes = await openai.extractAttributes(artifact, { apiKey: auth.apiKey });
      } else {
        fail('no attribute flags and no API key for vision extraction — pass --fonts/--colors/--layouts/--aesthetics');
      }
    }
    const profile = loadProfile(path);
    const next = updateTaste(profile, { verdict: sub, attributes, sessionId: args.session || basename(artifact), artifact });
    saveProfile(path, next);
    out({ ok: true, verdict: sub, attributes, path });
    return;
  }

  fail(`unknown taste subcommand "${sub}" (read | approved | rejected)`);
}

// ── router ──────────────────────────────────────────────────────────────────
const COMMANDS = {
  setup: cmdSetup,
  doctor: cmdDoctor,
  generate: cmdGenerate,
  variants: cmdVariants,
  evolve: cmdEvolve,
  iterate: cmdIterate,
  record: cmdRecord,
  check: cmdCheck,
  daemon: cmdDaemon,
  board: cmdBoard,
  feedback: cmdFeedback,
  taste: cmdTaste,
};

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || !COMMANDS[cmd]) {
  errLine(`planr-design <${Object.keys(COMMANDS).join('|')}>`);
  process.exit(cmd ? 1 : 0);
}
COMMANDS[cmd](args).catch((e) => fail(e.message));
