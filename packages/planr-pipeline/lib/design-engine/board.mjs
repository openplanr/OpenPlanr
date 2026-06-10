/**
 * Board UI generator — ONE self-contained HTML file (inline CSS/JS, no CDN,
 * works offline, localhost only). The board is the CHOOSER; AskUserQuestion is
 * only the blocking wait (hard rule 2).
 *
 * Modes
 *   loop   — N variant cards (png/svg/html), each with stars, comment,
 *            "More like this", and a PIN layer (click = point pin, drag = region).
 *   review — ONE artifact iframe (finalized.html/canvas.html) with the pin layer
 *            mapping every pin to its nearest <section id> / [data-screen].
 *
 * Interaction model (v0.19.2): html artifacts (walkthroughs, CANVASES) start in
 * **Interact** mode — the pin layer passes pointer events through, so a canvas
 * pans/zooms exactly as it does standalone. A header **Pin** toggle (or the P
 * key) arms annotation; images/SVGs default to Pin since they have no
 * interaction of their own. Submission is unmistakable: the approve button
 * morphs into a receipt of exactly what was written to feedback.json.
 *
 * Visual language: cream + teal premium palette
 *   #f7f3e7 canvas · #e1f2e8 mint surface · #b4e7d9 hairline · #7cd2c1 soft
 *   accent · #4ab8a1 hover · #1f8f7d primary. One accent family, 4pt grid.
 */

import { embedJson } from '../design/escape.mjs';

export function renderBoardHtml(config) {
  const {
    boardId,
    title = 'Design board',
    mode = 'loop',
    variants = [], // [{ id: 'A', label, src, type: 'image'|'svg'|'html' }]
  } = config;

  const cfg = { boardId, title, mode, variants };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title.replace(/</g, '&lt;')}</title>
<style>
  :root {
    --cream:#f7f3e7; --mint:#e1f2e8; --hairline:#b4e7d9; --soft:#7cd2c1;
    --hover:#4ab8a1; --primary:#1f8f7d;
    --ink:#16302a; --muted:#5c7068; --card:#ffffff;
    --radius:12px; --radius-sm:8px;
    --shadow:0 1px 2px rgba(22,48,42,.05), 0 8px 24px rgba(31,143,125,.07);
  }
  * { box-sizing:border-box }
  body { margin:0; background:var(--cream); color:var(--ink);
         font:14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         -webkit-font-smoothing:antialiased }
  button { font:inherit }

  header { position:sticky; top:0; z-index:40; display:flex; align-items:center; gap:12px;
           padding:12px 24px; background:rgba(247,243,231,.92); backdrop-filter:blur(8px);
           border-bottom:1px solid var(--hairline) }
  header .dot { width:10px; height:10px; border-radius:3px; background:var(--primary); flex:0 0 auto }
  header h1 { font-size:15px; margin:0; font-weight:600; letter-spacing:-.01em }
  header .mode { font-size:11px; font-weight:600; color:var(--primary); background:var(--mint);
                 padding:4px 10px; border-radius:999px; text-transform:uppercase; letter-spacing:.08em }
  header .spacer { flex:1 }
  .seg { display:flex; background:var(--mint); border:1px solid var(--hairline); border-radius:999px; padding:2px }
  .seg button { border:0; background:transparent; color:var(--muted); font-size:12px; font-weight:600;
                padding:6px 14px; border-radius:999px; cursor:pointer; transition:all .15s ease }
  .seg button.on { background:var(--primary); color:#fff }
  .hint { color:var(--muted); font-size:12px }

  .banner { display:none; align-items:center; gap:12px; padding:12px 24px; font-weight:600; font-size:13.5px }
  .banner.show { display:flex }
  .banner.ok { background:var(--mint); color:var(--primary); border-bottom:1px solid var(--hairline) }
  .banner.pending { background:#fff; color:var(--primary); border-bottom:1px dashed var(--soft) }
  .banner .badge { background:var(--primary); color:#fff; border-radius:999px; width:22px; height:22px;
                   display:flex; align-items:center; justify-content:center; font-size:13px; flex:0 0 auto }

  main { padding:24px; display:grid; gap:24px; max-width:1760px; margin:0 auto }
  .grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)) }
  .grid.single { grid-template-columns:1fr }

  .card { background:var(--card); border:1px solid var(--hairline); border-radius:var(--radius);
          overflow:hidden; box-shadow:var(--shadow) }
  .card .head { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--mint) }
  .card .head .vid { width:24px; height:24px; border-radius:7px; background:var(--mint); color:var(--primary);
                     font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center }
  .card .head .lbl { font-size:13px; color:var(--muted) }
  .card .head .state { margin-left:auto; font-size:12px; font-weight:600; color:var(--muted) }
  .state .spin { display:inline-block; width:10px; height:10px; border:2px solid var(--soft);
                 border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;
                 vertical-align:-1px; margin-right:6px }
  @keyframes spin { to { transform:rotate(360deg) } }

  .mediawrap { position:relative; background:#fff }
  .mediawrap img, .mediawrap object { display:block; width:100%; height:auto }
  .mediawrap iframe { display:block; width:100%; height:78vh; border:0; background:#fff }
  .pinlayer { position:absolute; inset:0; cursor:crosshair }
  .pinlayer.pass { pointer-events:none }
  .pin { position:absolute; transform:translate(-50%,-100%); z-index:5; pointer-events:auto }
  .pin .dot { width:24px; height:24px; border-radius:50% 50% 50% 0; background:var(--primary);
              color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center;
              justify-content:center; transform:rotate(-45deg); box-shadow:0 2px 10px rgba(22,48,42,.35);
              border:2px solid #fff }
  .pin .dot span { transform:rotate(45deg) }
  .region { position:absolute; border:2px dashed var(--primary); background:rgba(31,143,125,.08);
            border-radius:4px; z-index:4; pointer-events:none }
  .popover { position:absolute; z-index:50; width:280px; background:var(--card);
             border:1px solid var(--hairline); border-radius:var(--radius); padding:12px;
             box-shadow:0 12px 40px rgba(22,48,42,.18) }
  .popover textarea { min-height:56px; margin-bottom:8px }
  .popover .row { display:flex; gap:8px; margin-top:8px }

  .controls { padding:12px 16px 16px; display:grid; gap:10px; border-top:1px solid var(--mint); background:#fff }
  .stars { display:flex; gap:2px }
  .stars button { background:none; border:0; font-size:22px; cursor:pointer; color:var(--hairline);
                  padding:0 2px; transition:color .12s ease, transform .12s ease }
  .stars button:hover { transform:scale(1.15) }
  .stars button.on { color:var(--hover) }

  textarea, select, input[type=text] { background:#fff; color:var(--ink); border:1px solid var(--hairline);
            border-radius:var(--radius-sm); padding:9px 12px; font:inherit; width:100% }
  textarea:focus, select:focus, input[type=text]:focus { outline:2px solid var(--soft); outline-offset:1px; border-color:var(--hover) }
  select { width:auto; cursor:pointer }

  button.btn { background:#fff; color:var(--ink); border:1px solid var(--hairline); border-radius:var(--radius-sm);
               padding:9px 14px; cursor:pointer; font-weight:500; transition:all .15s ease }
  button.btn:hover { border-color:var(--hover); color:var(--primary); background:var(--mint) }
  button.btn:active { transform:scale(.985) }
  button.btn.primary { background:var(--primary); border-color:var(--primary); color:#fff; font-weight:600;
                       padding:10px 20px }
  button.btn.primary:hover { background:var(--hover); border-color:var(--hover); color:#fff }
  button.btn.primary:disabled { background:var(--primary); opacity:1; cursor:default; transform:none }
  button.btn.subtle { font-size:12.5px; padding:7px 12px }

  .panel { background:var(--card); border:1px solid var(--hairline); border-radius:var(--radius);
           padding:16px 20px; display:grid; gap:12px; box-shadow:var(--shadow) }
  .panel h2 { margin:0; font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:.1em;
              color:var(--primary) }
  .remixrow { display:flex; gap:12px; flex-wrap:wrap; align-items:center; font-size:13px; color:var(--muted) }

  .rail { display:flex; gap:12px; overflow-x:auto; padding:4px 0 }
  .rail .thumb { flex:0 0 auto; width:128px; cursor:pointer; border:2px solid var(--hairline); border-radius:var(--radius-sm);
                 overflow:hidden; background:#fff; transition:border-color .15s ease }
  .rail .thumb:hover { border-color:var(--soft) }
  .rail .thumb.sel { border-color:var(--primary) }
  .rail .thumb img, .rail .thumb object { width:100%; display:block; pointer-events:none }
  .rail .thumb .cap { font-size:11px; color:var(--muted); padding:4px 8px; background:var(--mint) }
  .diff { position:relative; max-width:920px; border:1px solid var(--hairline); border-radius:var(--radius); overflow:hidden }
  .diff img { display:block; width:100% }
  .diff .top { position:absolute; inset:0; overflow:hidden }
  .diff .top img { width:100% }
  .diff input[type=range] { position:absolute; left:16px; right:16px; bottom:12px; width:calc(100% - 32px); z-index:6 }

  .approve { position:sticky; bottom:0; z-index:40; display:flex; gap:16px; align-items:center;
             padding:14px 24px; background:rgba(255,255,255,.96); backdrop-filter:blur(8px);
             border-top:1px solid var(--hairline) }
  .approve label { font-size:13.5px; color:var(--muted); display:flex; align-items:center; gap:10px }
  .receipt { display:none; align-items:center; gap:14px; font-size:13.5px }
  .receipt.show { display:flex }
  .receipt .check { width:30px; height:30px; border-radius:50%; background:var(--primary); color:#fff;
                    display:flex; align-items:center; justify-content:center; font-size:15px; flex:0 0 auto;
                    animation:pop .35s cubic-bezier(.2,1.6,.4,1) }
  @keyframes pop { 0% { transform:scale(.3); opacity:0 } 100% { transform:scale(1); opacity:1 } }
  .receipt b { color:var(--primary) }
  .receipt .meta { color:var(--muted) }
</style>
</head>
<body>
<header>
  <span class="dot"></span>
  <h1>${title.replace(/</g, '&lt;')}</h1>
  <span class="mode">${mode}</span>
  <span class="spacer"></span>
  <div class="seg" id="modeSeg" title="P toggles">
    <button id="m-interact">Interact</button>
    <button id="m-pin">Pin</button>
  </div>
  <span class="hint" id="modeHint"></span>
</header>
<div id="banner" class="banner"><span class="badge">✓</span><span id="bannerText"></span></div>
<main>
  <div class="grid ${mode === 'review' ? 'single' : ''}" id="grid"></div>

  <div class="panel" id="versionsPanel" hidden>
    <h2>Versions</h2>
    <div class="rail" id="rail"></div>
    <div class="diff" id="diff" hidden>
      <img id="diffBase" alt="base" />
      <div class="top"><img id="diffTop" alt="compare" /></div>
      <input id="diffSlider" type="range" min="0" max="100" value="50" />
    </div>
    <span class="hint">pick two thumbnails to A/B them with the slider</span>
  </div>

  <div class="panel" id="remixPanel">
    <h2>Iterate / remix</h2>
    <div class="remixrow">
      <label>layout from <select id="remixLayout"></select></label>
      <label>colors from <select id="remixColors"></select></label>
      <input type="text" id="remixNote" placeholder="remix note (optional)" style="flex:1;min-width:220px" />
      <button class="btn" id="remixBtn">Remix</button>
    </div>
    <textarea id="overall" placeholder="Overall direction — what should the next round do?"></textarea>
    <div class="remixrow">
      <button class="btn" id="iterateBtn">Regenerate with this feedback</button>
      <span class="hint">sends feedback-pending.json to your agent and waits</span>
    </div>
  </div>
</main>

<div class="approve">
  <div id="approveForm" style="display:flex;gap:16px;align-items:center">
    <label>We'll run with <select id="approveSel"></select></label>
    <button class="btn primary" id="submitBtn">Approve &amp; submit feedback</button>
    <span class="hint">writes feedback.json — then return to your coding agent</span>
  </div>
  <div class="receipt" id="receipt">
    <span class="check">✓</span>
    <span><b>Feedback submitted</b> <span id="receiptMeta" class="meta"></span></span>
    <span class="hint">— return to your coding agent and tell it you're done</span>
  </div>
</div>

<script>
var CFG = /* GENERATOR:config */ ${embedJson(cfg)};
(function () {
  'use strict';
  var hasHtml = CFG.variants.some(function (v) { return v.type === 'html'; });
  var state = { ratings:{}, comments:{}, pins:[], railSel:[], lastReloadGen:null,
                pinMode: !hasHtml }; // canvases/walkthroughs start interactive
  var grid = document.getElementById('grid');
  var banner = document.getElementById('banner');
  var bannerText = document.getElementById('bannerText');

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  // ── interact / pin mode ───────────────────────────────────────────────
  var segI = document.getElementById('m-interact');
  var segP = document.getElementById('m-pin');
  var modeHint = document.getElementById('modeHint');
  function applyMode() {
    segI.classList.toggle('on', !state.pinMode);
    segP.classList.toggle('on', state.pinMode);
    document.querySelectorAll('.pinlayer').forEach(function (l) {
      l.classList.toggle('pass', !state.pinMode);
    });
    modeHint.textContent = state.pinMode
      ? 'click to pin · drag to mark a region'
      : (hasHtml ? 'pan / zoom / scroll the design freely — switch to Pin to annotate' : '');
  }
  segI.onclick = function () { state.pinMode = false; applyMode(); };
  segP.onclick = function () { state.pinMode = true; applyMode(); };
  document.addEventListener('keydown', function (e) {
    if (e.key.toLowerCase() === 'p' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      state.pinMode = !state.pinMode; applyMode();
    }
  });

  // ── variant cards ─────────────────────────────────────────────────────
  CFG.variants.forEach(function (v) {
    var card = el('div', 'card');
    card.dataset.variant = v.id;
    var head = el('div', 'head');
    head.appendChild(el('span', 'vid', v.id === 'artifact' ? '◈' : v.id));
    head.appendChild(el('span', 'lbl', v.label || ''));
    var stateEl = el('span', 'state', '');
    head.appendChild(stateEl);
    card.appendChild(head);

    var wrap = el('div', 'mediawrap');
    var media;
    if (v.type === 'html') { media = el('iframe'); media.src = v.src; }
    else if (v.type === 'svg') { media = el('object'); media.type = 'image/svg+xml'; media.data = v.src; }
    else { media = el('img'); media.src = v.src; media.alt = v.id; }
    wrap.appendChild(media);
    var layer = el('div', 'pinlayer');
    layer.dataset.variant = v.id;
    wrap.appendChild(layer);
    card.appendChild(wrap);
    attachPinLayer(layer, media, v);

    var controls = el('div', 'controls');
    var stars = el('div', 'stars');
    for (var s = 1; s <= 5; s++) (function (n) {
      var b = el('button', '', '★');
      b.setAttribute('aria-label', n + ' star' + (n > 1 ? 's' : ''));
      b.onclick = function () {
        state.ratings[v.id] = n;
        Array.prototype.forEach.call(stars.children, function (c, i) { c.classList.toggle('on', i < n); });
      };
      stars.appendChild(b);
    })(s);
    controls.appendChild(stars);
    var comment = el('textarea');
    comment.placeholder = 'Notes on ' + (v.id === 'artifact' ? 'this design' : v.id) + '…';
    comment.oninput = function () { state.comments[v.id] = comment.value; };
    controls.appendChild(comment);
    if (CFG.mode === 'loop') {
      var more = el('button', 'btn subtle', 'More like ' + v.id);
      more.onclick = function () { sendPending('more-like', { preferred: v.id }); };
      controls.appendChild(more);
    }
    card.appendChild(controls);
    grid.appendChild(card);
  });
  applyMode();

  // ── pins (click = point, drag = region); review maps to screen ids ────
  function attachPinLayer(layer, media, variant) {
    var down = null;
    layer.addEventListener('mousedown', function (e) {
      if (e.target.closest('.pin') || e.target.closest('.popover')) return;
      var r = layer.getBoundingClientRect();
      down = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    layer.addEventListener('mouseup', function (e) {
      if (!down) return;
      var r = layer.getBoundingClientRect();
      var up = { x: e.clientX - r.left, y: e.clientY - r.top };
      var box = {
        x: Math.min(down.x, up.x) / r.width,
        y: Math.min(down.y, up.y) / r.height,
        w: Math.abs(up.x - down.x) / r.width,
        h: Math.abs(up.y - down.y) / r.height,
      };
      if (box.w * r.width < 8 && box.h * r.height < 8) { box.w = 0; box.h = 0; }
      down = null;
      var screen = CFG.mode === 'review' ? screenAt(media, e) : undefined;
      openPopover(layer, box, variant.id, screen);
    });
  }

  function screenAt(media, e) {
    try {
      if (media.tagName !== 'IFRAME') return undefined;
      var doc = media.contentDocument;
      var ir = media.getBoundingClientRect();
      var node = doc.elementFromPoint(e.clientX - ir.left, e.clientY - ir.top);
      while (node && node !== doc.body) {
        if (node.dataset && node.dataset.screen) return node.dataset.screen;
        if (node.tagName === 'SECTION' && node.id) return node.id;
        node = node.parentElement;
      }
    } catch (err) { /* cross-origin or detached — pin still records coords */ }
    return undefined;
  }

  function openPopover(layer, box, variantId, screen) {
    closePopovers();
    var pop = el('div', 'popover');
    pop.style.left = 'min(' + (box.x * 100) + '%, calc(100% - 296px))';
    pop.style.top = (box.y * 100) + '%';
    var ta = el('textarea'); ta.placeholder = 'What should change here?';
    var sel = el('select', '', '<option value="fix">fix</option><option value="improve">improve</option><option value="question">question</option>');
    if (screen) pop.appendChild(el('div', 'hint', 'screen: ' + screen));
    var row = el('div', 'row');
    var ok = el('button', 'btn primary subtle', 'Pin it');
    var cancel = el('button', 'btn subtle', 'Cancel');
    ok.onclick = function () {
      if (!ta.value.trim()) { ta.focus(); return; }
      var pin = { variant: screen || variantId, x: box.x, y: box.y, w: box.w, h: box.h,
                  comment: ta.value.trim(), intent: sel.value };
      if (screen) pin.screen = screen;
      state.pins.push(pin);
      renderPin(layer, pin, state.pins.length);
      pop.remove();
    };
    cancel.onclick = function () { pop.remove(); };
    row.appendChild(ok); row.appendChild(cancel);
    pop.appendChild(ta); pop.appendChild(sel); pop.appendChild(row);
    layer.appendChild(pop);
    ta.focus();
  }
  function closePopovers() {
    document.querySelectorAll('.popover').forEach(function (p) { p.remove(); });
  }

  function renderPin(layer, pin, n) {
    if (pin.w > 0 || pin.h > 0) {
      var reg = el('div', 'region');
      reg.style.left = (pin.x * 100) + '%';
      reg.style.top = (pin.y * 100) + '%';
      reg.style.width = (pin.w * 100) + '%';
      reg.style.height = (pin.h * 100) + '%';
      layer.appendChild(reg);
    }
    var marker = el('div', 'pin');
    marker.style.left = (pin.x * 100) + '%';
    marker.style.top = (pin.y * 100) + '%';
    marker.title = '[' + pin.intent + '] ' + pin.comment + (pin.screen ? ' (screen: ' + pin.screen + ')' : '');
    marker.appendChild(el('div', 'dot', '<span>' + n + '</span>'));
    layer.appendChild(marker);
  }

  // ── remix / approve selectors ─────────────────────────────────────────
  ['remixLayout', 'remixColors', 'approveSel'].forEach(function (id) {
    var sel = document.getElementById(id);
    CFG.variants.forEach(function (v) {
      var o = document.createElement('option'); o.value = v.id; o.textContent = v.id; sel.appendChild(o);
    });
  });

  function payload(extra) {
    var base = {
      schema_version: '1.0.0',
      boardId: CFG.boardId,
      publishedAt: new Date().toISOString(),
      ratings: state.ratings,
      comments: state.comments,
      overall: document.getElementById('overall').value || '',
      regenerated: false,
      pins: state.pins,
    };
    Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
    return base;
  }

  function post(kind, feedback, after) {
    fetch('api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: kind, feedback: feedback }),
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (r.error) { alert('Feedback rejected: ' + r.error); return; }
      after();
    }).catch(function (e) { alert('Could not reach the board daemon: ' + e); });
  }

  function summary(fb) {
    var bits = [];
    if (fb.preferred) bits.push('running with ' + fb.preferred);
    var rated = Object.keys(fb.ratings).length;
    if (rated) bits.push(rated + ' rating' + (rated > 1 ? 's' : ''));
    if (fb.pins.length) bits.push(fb.pins.length + ' pin' + (fb.pins.length > 1 ? 's' : ''));
    if (fb.overall) bits.push('overall note');
    return bits.join(' · ') || 'recorded';
  }

  function sendPending(action, extra) {
    var fb = payload(extra);
    fb.regenerated = true;
    fb.regenerateAction = action;
    post('pending', fb, function () {
      banner.className = 'banner pending show';
      banner.querySelector('.badge').textContent = '↻';
      bannerText.textContent = 'Sent to your agent (' + action + ' · ' + summary(fb) + ') — keep this tab open; it reloads when the new round lands.';
      banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  document.getElementById('remixBtn').onclick = function () {
    sendPending('remix', { remixSpec: {
      layoutFrom: document.getElementById('remixLayout').value,
      colorsFrom: document.getElementById('remixColors').value,
      note: document.getElementById('remixNote').value || '',
    } });
  };
  document.getElementById('iterateBtn').onclick = function () { sendPending('iterate', {}); };
  document.getElementById('submitBtn').onclick = function () {
    var fb = payload({ preferred: document.getElementById('approveSel').value });
    var btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Writing feedback.json…';
    post('submit', fb, function () {
      document.getElementById('approveForm').style.display = 'none';
      document.getElementById('receiptMeta').textContent = '(' + summary(fb) + ')';
      document.getElementById('receipt').classList.add('show');
      banner.className = 'banner ok show';
      banner.querySelector('.badge').textContent = '✓';
      bannerText.textContent = 'Feedback received — feedback.json written next to the board. Return to your coding agent.';
      document.title = '✓ ' + document.title;
    });
  };

  // ── live progress + in-tab reload + versions rail ─────────────────────
  function applyProgress(p) {
    (p.variants ? Object.keys(p.variants) : []).forEach(function (vid) {
      var card = document.querySelector('.card[data-variant="' + vid + '"] .state');
      if (!card) return;
      var st = p.variants[vid];
      card.innerHTML = st === 'generating' || st === 'checking' || st === 'queued'
        ? '<span class="spin"></span>' + st
        : st === 'failed' ? '✗ failed' : st === 'done' ? '✓ done' : st;
    });
    if (p.versions && Object.keys(p.versions).some(function (k) { return (p.versions[k] || []).length; })) {
      renderRail(p.versions);
    }
    if (state.lastReloadGen === null) state.lastReloadGen = p.reloadGen;
    else if (p.reloadGen !== state.lastReloadGen) location.reload();
  }
  function renderRail(versions) {
    var rail = document.getElementById('rail');
    document.getElementById('versionsPanel').hidden = false;
    rail.innerHTML = '';
    Object.keys(versions).forEach(function (vid) {
      versions[vid].forEach(function (file, i) {
        var t = el('div', 'thumb');
        t.dataset.file = file;
        t.innerHTML = (/\\.svg$/.test(file)
          ? '<object type="image/svg+xml" data="' + file + '"></object>'
          : '<img src="' + file + '" alt="">') +
          '<div class="cap">' + vid + ' · v' + (i + 1) + '</div>';
        t.onclick = function () { toggleRailSel(t); };
        rail.appendChild(t);
      });
    });
  }
  function toggleRailSel(t) {
    var i = state.railSel.indexOf(t);
    if (i >= 0) state.railSel.splice(i, 1); else state.railSel.push(t);
    while (state.railSel.length > 2) state.railSel.shift().classList.remove('sel');
    document.querySelectorAll('.rail .thumb').forEach(function (x) { x.classList.remove('sel'); });
    state.railSel.forEach(function (x) { x.classList.add('sel'); });
    var diff = document.getElementById('diff');
    if (state.railSel.length === 2) {
      diff.hidden = false;
      document.getElementById('diffBase').src = state.railSel[0].dataset.file;
      document.getElementById('diffTop').src = state.railSel[1].dataset.file;
    } else diff.hidden = true;
  }
  document.getElementById('diffSlider').oninput = function () {
    document.querySelector('#diff .top').style.clipPath = 'inset(0 ' + (100 - this.value) + '% 0 0)';
  };

  function poll() {
    fetch('api/progress').then(function (r) { return r.json(); }).then(applyProgress).catch(function () {});
  }
  setInterval(poll, 1500);
  poll();
})();
</script>
</body>
</html>
`;
}
