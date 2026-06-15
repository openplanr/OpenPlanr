#!/usr/bin/env node
/**
 * Design-loop conformance — a FULL loop, no external network, deterministic:
 *
 *   contract → author (claude-svg) → check → record → board (real localhost
 *   daemon) → pending feedback (pins) → consume → iterate (edit + record) →
 *   reload → submit (preferred) → approved.json → taste updated (approve+reject)
 *
 * Exit 0 = the whole handshake works end-to-end; non-zero = at least one break.
 * Localhost HTTP only (the daemon under test) — zero external calls, $0.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const log = (...a) => console.log(...a);
let failures = 0;
const ok = (label) => log(`  ✓ ${label}`);
const bad = (label, detail) => { log(`  ✗ ${label}`); if (detail) log(`    ${detail}`); failures += 1; };
const assert = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

const HOME = mkdtempSync(join(tmpdir(), 'planr-loop-home-'));
process.env.PLANR_HOME = HOME;

const { validate } = await import(join(root, 'conformance/json-schema-validate.mjs'));
const { sheetContract, contractInstructions, validateSheet } = await import(join(root, 'lib/design-engine/providers/claudeSvg.mjs'));
const { createSession, appendRound, saveSession, loadSession } = await import(join(root, 'lib/design-engine/session.mjs'));
const { createDaemon, DAEMON_VERSION } = await import(join(root, 'lib/design-engine/daemon.mjs'));
const { renderBoardHtml } = await import(join(root, 'lib/design-engine/board.mjs'));
const { readFeedback } = await import(join(root, 'lib/design-engine/feedback.mjs'));
const { emptyProfile, updateTaste, saveProfile, loadProfile } = await import(join(root, 'lib/design-engine/taste.mjs'));

log('OpenPlanr design-loop conformance (mocked full loop, $0)\n');

// 0 — orchestration + engine files present
log('orchestration:');
for (const rel of [
  'commands/design-loop.md',
  'commands/design-review.md',
  'procedures/design-loop-step0-context.md',
  'procedures/design-loop-step1-gate.md',
  'procedures/design-loop-step2-variants.md',
  'procedures/design-loop-step3-board.md',
  'procedures/design-loop-step4-approve.md',
  'procedures/design-review-loop.md',
  'lib/design-engine/cli.mjs',
  'lib/design-engine/daemon.mjs',
  'lib/design-engine/board.mjs',
  'schemas/v1.0.0/design-feedback.schema.json',
  'schemas/v1.0.0/design-session.schema.json',
  'schemas/v1.0.0/taste-profile.schema.json',
  'schemas/v1.0.0/design-approved.schema.json',
  'docs/design-loop.md',
]) assert(existsSync(join(root, rel)), rel);

// 1 — contract + author + check
log('\ngenerate (claude-svg):');
const contract = sheetContract('logo');
assert(contractInstructions(contract).includes('section-mark'), 'contract instructions name the required sections');
const sessionDir = join(HOME, 'designs/conf/logo-loop');
mkdirSync(sessionDir, { recursive: true });
const svg = (stroke) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<g id="tile-light"><g id="section-mark"><path d="M10 10 H100" stroke-width="${stroke}"/></g>
<g id="section-wordmark"><text font-family="system-ui">conf</text></g>
<g id="section-lockup"><text>conf lockup</text></g></g>
<g id="tile-dark"><rect fill="#111"/><text fill="#fff">conf</text></g></svg>`;
const v1 = join(sessionDir, 'variant-A.svg');
writeFileSync(v1, svg(8));
assert(validateSheet(readFileSync(v1, 'utf-8'), contract).pass, 'authored sheet passes the structural quality gate');

// 2 — session record
let session = createSession({ id: 'conf-A', provider: 'claude-svg', target: 'logo', project: 'conf', brief: 'conf mark' });
session = appendRound(session, { outputPath: v1, responseId: null });
saveSession(sessionDir, 'A', session);
assert(existsSync(join(sessionDir, 'session-A.json')), 'session persisted in the session dir (not /tmp)');

// 3 — board through a REAL localhost daemon
log('\nboard + daemon:');
writeFileSync(join(sessionDir, 'board.html'), renderBoardHtml({
  boardId: 'conf-loop', title: 'conf', mode: 'loop',
  variants: [{ id: 'A', label: 'variant-A.svg', src: 'variant-A.svg', type: 'svg' }],
}));
writeFileSync(join(sessionDir, 'progress.json'), JSON.stringify({ variants: { A: 'done' }, versions: { A: ['variant-A.svg'] } }));
const daemon = createDaemon();
const port = await daemon.listen(0);
const base = `http://127.0.0.1:${port}`;
const reg = await (await fetch(`${base}/api/boards`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'conf-loop', dir: sessionDir }),
})).json();
assert(reg.ok === true, 'board registered with the daemon');
const served = await (await fetch(`${base}/boards/conf-loop/`)).text();
assert(served.includes('conf') && served.includes('api/feedback'), 'board HTML served with the feedback wiring');

// trailing-slash canon (the broken-images bug): /boards/<id> must 301 → /boards/<id>/,
// never serve the page at a base that breaks every relative URL.
const noSlash = await fetch(`${base}/boards/conf-loop`, { redirect: 'manual' });
assert(noSlash.status === 301 && (noSlash.headers.get('location') ?? '').endsWith('/boards/conf-loop/'),
  'slash-less board URL 301-redirects to the canonical slash form');
const followed = await (await fetch(`${base}/boards/conf-loop`)).text();
assert(followed.includes('api/feedback'), 'following the redirect lands on the working board');
assert(followed.includes('m-interact') && followed.includes('pinlayer'),
  'board ships the Interact/Pin mode toggle (canvas artifacts stay pannable)');
assert(followed.includes('receipt') && followed.includes('Feedback submitted'),
  'board ships the submission receipt UI');
assert(followed.includes('id="btnExport"') && followed.includes('function domExport('),
  'board ships PNG/HTML export (rasteriser + button)');
assert(followed.includes('reference image') && followed.includes('design-spec.md'),
  'export frames PNG as a reference image, HTML/spec as the real handoff');
assert(followed.includes('jpe?g') && followed.includes('diffab'),
  'board renders html artifacts type-correctly: ◈ version thumbnail + iframe A/B compare (never a broken <img>)');
const head = await fetch(`${base}/boards/conf-loop/variant-A.svg`, { method: 'HEAD' });
assert(head.status === 200, 'HEAD on a board asset answers 200');

// the root index must NOT enumerate boards — a registered board name must never
// leak into the shared index (cross-project confidentiality, SPEC-017 scoping).
const indexHtml = await (await fetch(`${base}/`)).text();
assert(!indexHtml.includes('conf-loop'), 'root index does not enumerate registered board names');

// the daemon reports its behaviour version, so a client can detect a daemon
// running stale code and restart it instead of reusing it (SPEC-017).
const health = await (await fetch(`${base}/health`)).json();
assert(health.version === DAEMON_VERSION, 'daemon /health reports its version (stale-daemon restart guard)');

// 4 — pending feedback with a pin → consumed on read
log('\nfeedback handshake:');
const pending = {
  schema_version: '1.0.0', boardId: 'conf-loop', publishedAt: new Date().toISOString(),
  ratings: { A: 4 }, comments: { A: 'thicker' }, overall: 'bolder mark',
  regenerated: true, regenerateAction: 'iterate',
  pins: [{ variant: 'A', x: 0.1, y: 0.1, w: 0.2, h: 0.1, comment: 'stroke too thin here', intent: 'fix' }],
};
const postPending = await (await fetch(`${base}/boards/conf-loop/api/feedback`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'pending', feedback: pending }),
})).json();
assert(postPending.ok === true, 'daemon accepted (and schema-validated) the pending feedback');
const round1 = readFeedback(sessionDir);
assert(round1?.kind === 'pending' && round1.feedback.pins[0].intent === 'fix', 'agent read the pending round with its pin');
assert(!existsSync(join(sessionDir, 'feedback-pending.json')), 'pending CONSUMED on read');

// 5 — iterate: edit per the pin, record, reload
const v2 = join(sessionDir, 'variant-A-v2.svg');
writeFileSync(v2, svg(16)); // the "fix": thicker stroke
assert(validateSheet(readFileSync(v2, 'utf-8'), contract).pass, 'iterated sheet still passes the gate');
session = appendRound(loadSession(sessionDir, 'A'), { outputPath: v2, feedback: 'bolder mark (pin: stroke too thin)' });
saveSession(sessionDir, 'A', session);
assert(loadSession(sessionDir, 'A').outputPaths.length === 2, 'session chained the iterate round');
const reload = await (await fetch(`${base}/boards/conf-loop/api/reload`, { method: 'POST' })).json();
const prog = await (await fetch(`${base}/boards/conf-loop/api/progress`)).json();
assert(reload.ok === true && prog.reloadGen === 1, 'reload bumps the generation the board polls');

// 6 — submit with preferred → approved.json → taste both verdicts
log('\napprove + taste:');
const submit = { ...pending, regenerated: false, preferred: 'A' };
delete submit.regenerateAction;
await fetch(`${base}/boards/conf-loop/api/feedback`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'submit', feedback: submit }),
});
const finalRound = readFeedback(sessionDir);
assert(finalRound?.kind === 'submit' && finalRound.feedback.preferred === 'A', 'submit round carries preferred');

const approvedSchema = JSON.parse(readFileSync(join(root, 'schemas/v1.0.0/design-approved.schema.json'), 'utf-8'));
const approved = {
  schema_version: '1.0.0', boardId: 'conf-loop', sessionId: 'conf-A', approvedVariant: 'A',
  approvedPath: v2, provider: 'claude-svg', target: 'logo',
  approvedAt: new Date().toISOString(), copiedTo: [], notes: 'bolder mark',
};
assert(validate(approved, approvedSchema).length === 0, 'approved.json validates');
writeFileSync(join(sessionDir, 'approved.json'), JSON.stringify(approved, null, 2));

const tastePath = join(HOME, 'designs/conf/taste-profile.json');
let profile = updateTaste(emptyProfile(), { verdict: 'approved', attributes: { aesthetics: ['minimal'], colors: ['indigo'] }, sessionId: 'conf-A', artifact: v2 });
profile = updateTaste(profile, { verdict: 'rejected', attributes: { aesthetics: ['playful'] }, sessionId: 'conf-B', artifact: v1 });
saveProfile(tastePath, profile);
const read = loadProfile(tastePath);
assert(read.sessions.length === 2, 'taste recorded BOTH the approval and the rejection');
assert(read.dimensions.aesthetics.some((e) => e.value === 'minimal' && e.approved_count === 1), 'approved attribute present');

await daemon.close();
rmSync(HOME, { recursive: true, force: true });

log('');
if (failures === 0) { log('✓ all design-loop conformance checks passed'); process.exit(0); }
log(`✗ ${failures} design-loop conformance check(s) failed`);
process.exit(1);
