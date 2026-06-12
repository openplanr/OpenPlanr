/**
 * Board UI generator — ONE self-contained HTML file (inline CSS/JS, no CDN,
 * works offline, localhost only). The board is the CHOOSER; AskUserQuestion is
 * only the blocking wait (hard rule 2).
 *
 * v0.19.3 shell: a design-tool layout —
 *   ┌ top bar: title · mode · Interact/Pin · panel toggles ┐
 *   │ left rail: variants (live state) + versions/A-B      │
 *   │ stage: the selected design, full-bleed on a dot grid │
 *   │ right rail: inspector — rating, notes, pins, actions │
 *   └ approve dock lives at the inspector's foot ──────────┘
 * Both rails collapse (⌘/ctrl-free: click, or [ and ] keys). Density is
 * compact (12.5–13px chrome); ONE accent family (teal) on layered cream
 * neutrals — structure is drawn with warm hairlines, teal means interactive.
 *
 * Interaction: html artifacts (canvases, walkthroughs) load in Interact mode —
 * the pin layer passes pointer events through so pan/zoom works natively;
 * Pin (or the P key) arms annotation. Images/SVGs default to Pin.
 * Submission morphs the approve dock into a receipt of what was written.
 *
 * Handshake (unchanged): POST api/feedback {kind: submit|pending, feedback};
 * progress.json + reloadGen polling; pins carry normalized coords (+ screen id
 * in review mode, captured from the artifact's <section id>/[data-screen]).
 *
 * Palette: #f7f3e7 cream · #efe9d8 stage · #e1f2e8 mint · #b4e7d9 soft hairline
 *          #7cd2c1 · #4ab8a1 hover · #1f8f7d primary · ink #1d2a26.
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
    --cream:#f7f3e7; --stage:#efe9d8; --panel:#fcfaf3; --card:#ffffff;
    --mint:#e1f2e8; --soft:#b4e7d9; --accent2:#7cd2c1; --hover:#4ab8a1; --primary:#1f8f7d;
    --ink:#1d2a26; --muted:#6b7a74; --line:#e6dfcc; --line-strong:#d8d0b8;
    --r:10px; --rs:7px;
    --shadow:0 1px 2px rgba(29,42,38,.05), 0 6px 20px rgba(29,42,38,.06);
  }
  * { box-sizing:border-box }
  html, body { height:100% }
  body { margin:0; background:var(--cream); color:var(--ink);
         font:12.5px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         -webkit-font-smoothing:antialiased; overflow:hidden }
  button { font:inherit; cursor:pointer }
  ::-webkit-scrollbar { width:10px; height:10px }
  ::-webkit-scrollbar-thumb { background:var(--line-strong); border-radius:6px; border:3px solid var(--panel) }
  ::-webkit-scrollbar-track { background:transparent }

  .app { display:grid; grid-template-rows:44px 1fr; height:100vh }
  .main { display:grid; grid-template-columns:auto 1fr auto; min-height:0 }

  /* ── top bar ─────────────────────────────────────────────────────────── */
  .top { display:flex; align-items:center; gap:10px; padding:0 12px;
         background:var(--panel); border-bottom:1px solid var(--line) }
  .top .dot { width:9px; height:9px; border-radius:3px; background:var(--primary) }
  .top h1 { font-size:13px; margin:0; font-weight:600; letter-spacing:-.01em; white-space:nowrap;
            overflow:hidden; text-overflow:ellipsis; max-width:38vw }
  .chip { font-size:10px; font-weight:700; color:var(--primary); background:var(--mint);
          padding:3px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.08em }
  .top .spacer { flex:1 }
  .seg { display:flex; background:var(--cream); border:1px solid var(--line); border-radius:999px; padding:2px }
  .seg button { border:0; background:transparent; color:var(--muted); font-size:11.5px; font-weight:600;
                padding:4px 12px; border-radius:999px; transition:all .14s ease }
  .seg button.on { background:var(--primary); color:#fff }
  .iconbtn { width:28px; height:28px; border:1px solid var(--line); background:var(--panel);
             border-radius:var(--rs); color:var(--muted); display:flex; align-items:center;
             justify-content:center; font-size:13px; transition:all .14s ease }
  .iconbtn:hover { color:var(--primary); border-color:var(--soft) }
  .iconbtn.off { background:var(--cream); color:var(--line-strong) }
  .exportwrap { position:relative }
  .menu { position:absolute; right:0; top:34px; z-index:60; min-width:214px; background:var(--card);
          border:1px solid var(--line); border-radius:var(--r); padding:5px;
          box-shadow:0 12px 36px rgba(29,42,38,.16) }
  .menu button { display:block; width:100%; text-align:left; border:0; background:transparent;
                 color:var(--ink); font-size:12.5px; padding:8px 10px; border-radius:var(--rs); cursor:pointer }
  .menu button:hover { background:var(--mint); color:var(--primary) }
  .menu .mhint { color:var(--muted); font-size:10.5px; padding:6px 10px 4px; line-height:1.45 }
  .menu .sep { height:1px; background:var(--line); margin:4px 2px }
  .hint { color:var(--muted); font-size:11.5px; white-space:nowrap }

  .banner { position:fixed; top:52px; left:50%; transform:translateX(-50%); z-index:80;
            display:none; align-items:center; gap:10px; padding:9px 16px; font-weight:600;
            font-size:12.5px; border-radius:999px; box-shadow:var(--shadow);
            background:var(--ink); color:var(--mint) }
  .banner.show { display:flex; animation:drop .3s cubic-bezier(.2,1.4,.4,1) }
  @keyframes drop { from { transform:translate(-50%,-8px); opacity:0 } to { transform:translate(-50%,0); opacity:1 } }
  .banner .badge { color:var(--accent2) }

  /* ── rails ───────────────────────────────────────────────────────────── */
  .rail { background:var(--panel); overflow-y:auto; min-height:0; transition:width .16s ease }
  .rail.left { width:216px; border-right:1px solid var(--line) }
  .rail.right { width:296px; border-left:1px solid var(--line); display:flex; flex-direction:column }
  .rail.closed { width:0; overflow:hidden; border:0 }
  .sect { padding:12px 12px 4px }
  .sect h2 { margin:0 0 8px; font-size:10px; font-weight:700; text-transform:uppercase;
             letter-spacing:.1em; color:var(--muted) }

  .vitem { display:flex; align-items:center; gap:9px; padding:6px 8px; border-radius:var(--rs);
           cursor:pointer; border:1px solid transparent; margin-bottom:2px }
  .vitem:hover { background:var(--cream) }
  .vitem.on { background:var(--mint); border-color:var(--soft) }
  .vitem .thumb { width:44px; height:32px; border-radius:5px; background:var(--card);
                  border:1px solid var(--line); overflow:hidden; flex:0 0 auto;
                  display:flex; align-items:center; justify-content:center;
                  font-size:10px; font-weight:700; color:var(--muted) }
  .vitem .thumb img, .vitem .thumb object { width:100%; height:100%; object-fit:cover; pointer-events:none }
  .vitem .nm { flex:1; min-width:0 }
  .vitem .nm b { display:block; font-size:12px; font-weight:600 }
  .vitem .nm span { display:block; font-size:10.5px; color:var(--muted); white-space:nowrap;
                    overflow:hidden; text-overflow:ellipsis }
  .vitem .st { font-size:10px; font-weight:600; color:var(--muted) }
  .vitem .st.done { color:var(--primary) } .vitem .st.failed { color:#b4452f }
  .spin { display:inline-block; width:9px; height:9px; border:2px solid var(--soft);
          border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite }
  @keyframes spin { to { transform:rotate(360deg) } }

  .verthumb { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:var(--rs);
              cursor:pointer; border:1px solid transparent; font-size:11px; color:var(--muted) }
  .verthumb:hover { background:var(--cream) }
  .verthumb.sel { background:var(--mint); border-color:var(--soft); color:var(--primary) }
  .verthumb .vt { width:36px; height:26px; border-radius:4px; border:1px solid var(--line);
                  background:#fff; overflow:hidden; flex:0 0 auto }
  .verthumb .vt img, .verthumb .vt object { width:100%; height:100%; object-fit:cover; pointer-events:none }

  /* ── stage ───────────────────────────────────────────────────────────── */
  .stage { position:relative; min-width:0; min-height:0; overflow:auto; background:var(--stage);
           background-image:radial-gradient(rgba(29,42,38,.10) 1px, transparent 1px);
           background-size:22px 22px }
  .stagein { min-height:100%; display:flex; align-items:flex-start; justify-content:center; padding:20px }
  .frame { position:relative; flex:0 0 auto; background:var(--card); border-radius:var(--r);
           box-shadow:var(--shadow); overflow:hidden; border:1px solid var(--line) }
  .frame img, .frame object { display:block; max-width:100%; height:auto }
  .frame.fill { width:100%; height:calc(100vh - 44px - 40px) }
  .frame.fill iframe { width:100%; height:100%; border:0; display:block; background:#fff }
  .stagein.fillwrap { padding:12px; align-items:stretch }
  .stagein.fillwrap .frame { flex:1 }
  .pinlayer { position:absolute; inset:0; cursor:crosshair; z-index:6 }
  .pinlayer.pass { pointer-events:none }
  .pin { position:absolute; transform:translate(-50%,-100%); z-index:8; pointer-events:auto }
  .pin .pd { width:22px; height:22px; border-radius:50% 50% 50% 0; background:var(--primary);
             color:#fff; font-size:10.5px; font-weight:700; display:flex; align-items:center;
             justify-content:center; transform:rotate(-45deg); border:2px solid #fff;
             box-shadow:0 2px 8px rgba(29,42,38,.3) }
  .pin .pd span { transform:rotate(45deg) }
  .pin.hl .pd { background:var(--hover); transform:rotate(-45deg) scale(1.25) }
  .region { position:absolute; border:1.5px dashed var(--primary); background:rgba(31,143,125,.07);
            border-radius:4px; z-index:7; pointer-events:none }
  .popover { position:absolute; z-index:60; width:264px; background:var(--card);
             border:1px solid var(--line); border-radius:var(--r); padding:10px;
             box-shadow:0 12px 36px rgba(29,42,38,.16) }
  .popover .row { display:flex; gap:6px; margin-top:8px }
  .diffwrap { position:relative; max-width:100%; }
  .diffwrap img { display:block; max-width:100% }
  .diffwrap .topimg { position:absolute; inset:0; overflow:hidden }
  .diffwrap .topimg img { max-width:none; width:100% }
  .diffwrap input[type=range] { position:absolute; left:16px; right:16px; bottom:12px;
                                width:calc(100% - 32px); z-index:6 }
  .stagebar { position:sticky; bottom:0; display:flex; justify-content:center; padding:8px; z-index:10; pointer-events:none }
  .stagebar .inner { pointer-events:auto; display:flex; align-items:center; gap:10px; background:var(--ink);
                     color:var(--cream); border-radius:999px; padding:6px 14px; font-size:11.5px;
                     box-shadow:var(--shadow) }
  .stagebar b { color:#fff; font-weight:600 }
  .stagebar button { border:0; background:transparent; color:var(--accent2); font-size:13px; padding:0 2px }

  /* ── inspector ───────────────────────────────────────────────────────── */
  .insp { flex:1; overflow-y:auto; min-height:0 }
  .insp .sect { border-bottom:1px solid var(--line); padding-bottom:12px }
  .stars { display:flex; gap:1px }
  .stars button { background:none; border:0; font-size:19px; color:var(--line-strong);
                  padding:0 2px; transition:color .1s ease, transform .1s ease }
  .stars button:hover { transform:scale(1.12) }
  .stars button.on { color:var(--hover) }
  textarea, select, input[type=text] { background:var(--card); color:var(--ink);
            border:1px solid var(--line); border-radius:var(--rs); padding:7px 9px;
            font:inherit; width:100% }
  textarea:focus, select:focus, input[type=text]:focus { outline:2px solid var(--soft);
            outline-offset:1px; border-color:var(--hover) }
  textarea { min-height:54px; resize:vertical }
  select { width:auto; cursor:pointer }
  .btn { background:var(--card); color:var(--ink); border:1px solid var(--line);
         border-radius:var(--rs); padding:7px 12px; font-weight:500; font-size:12px;
         transition:all .14s ease }
  .btn:hover { border-color:var(--hover); color:var(--primary); background:var(--mint) }
  .btn:active { transform:scale(.985) }
  .btn.primary { background:var(--primary); border-color:var(--primary); color:#fff; font-weight:600;
                 padding:9px 16px; font-size:12.5px }
  .btn.primary:hover { background:var(--hover); border-color:var(--hover); color:#fff }
  .btn.block { width:100% }
  .pinrow { display:flex; gap:8px; align-items:flex-start; padding:7px 8px; border-radius:var(--rs);
            cursor:pointer; border:1px solid transparent; margin-bottom:2px }
  .pinrow:hover { background:var(--cream) }
  .pinrow .n { width:18px; height:18px; border-radius:50%; background:var(--primary); color:#fff;
               font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center;
               flex:0 0 auto; margin-top:1px }
  .pinrow .tx { flex:1; min-width:0; font-size:11.5px; line-height:1.45 }
  .pinrow .tx .it { font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
                    color:var(--primary); background:var(--mint); border-radius:4px; padding:1px 6px; margin-right:6px }
  .pinrow .tx .sc { color:var(--muted); font-size:10.5px }
  .pinrow .del { border:0; background:transparent; color:var(--muted); font-size:13px; padding:2px }
  .pinrow .del:hover { color:#b4452f }
  .empty { color:var(--muted); font-size:11.5px; padding:2px 8px }
  .fieldlbl { font-size:11px; color:var(--muted); margin:8px 0 4px }
  .inline { display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; color:var(--muted) }

  /* ── approve dock ────────────────────────────────────────────────────── */
  .dock { border-top:1px solid var(--line); background:var(--panel); padding:12px }
  .dock .inline { margin-bottom:8px }
  .receipt { display:none; align-items:flex-start; gap:10px; font-size:12.5px; line-height:1.5 }
  .receipt.show { display:flex }
  .receipt .check { width:26px; height:26px; border-radius:50%; background:var(--primary); color:#fff;
                    display:flex; align-items:center; justify-content:center; font-size:13px;
                    flex:0 0 auto; animation:pop .35s cubic-bezier(.2,1.6,.4,1) }
  @keyframes pop { 0% { transform:scale(.3); opacity:0 } 100% { transform:scale(1); opacity:1 } }
  .receipt b { color:var(--primary) }
  .receipt .meta { color:var(--muted); font-size:11.5px }
</style>
</head>
<body>
<div class="app">
<header class="top">
  <span class="dot"></span>
  <h1>${title.replace(/</g, '&lt;')}</h1>
  <span class="chip">${mode}</span>
  <span class="spacer"></span>
  <div class="seg" id="modeSeg" title="press P to toggle">
    <button id="m-interact">Interact</button>
    <button id="m-pin">Pin</button>
  </div>
  <span class="hint" id="modeHint"></span>
  <div class="exportwrap">
    <button class="iconbtn" id="btnExport" title="export PNG / HTML" aria-haspopup="true">⤓</button>
    <div class="menu" id="exportMenu" hidden></div>
  </div>
  <button class="iconbtn" id="tgL" title="toggle variants panel ( [ )">⟨</button>
  <button class="iconbtn" id="tgR" title="toggle inspector ( ] )">⟩</button>
</header>
<div class="banner" id="banner"><span class="badge" id="bannerBadge">✓</span><span id="bannerText"></span></div>

<div class="main">
  <nav class="rail left" id="railL">
    <div class="sect">
      <h2>Variants</h2>
      <div id="vlist"></div>
    </div>
    <div class="sect" id="versSect" hidden>
      <h2>Versions <span class="hint" style="text-transform:none;letter-spacing:0">· pick two to A/B</span></h2>
      <div id="vers"></div>
    </div>
  </nav>

  <section class="stage" id="stage">
    <div class="stagein" id="stagein"></div>
    <div class="stagebar" id="stagebar" hidden>
      <div class="inner">
        <button id="pgPrev" aria-label="previous">‹</button>
        <b id="pgLabel"></b>
        <button id="pgNext" aria-label="next">›</button>
      </div>
    </div>
  </section>

  <aside class="rail right" id="railR">
    <div class="insp">
      <div class="sect">
        <h2>Rate <span id="selName" style="text-transform:none;letter-spacing:0;color:var(--primary)"></span></h2>
        <div class="stars" id="stars"></div>
        <div class="fieldlbl">Notes</div>
        <textarea id="notes" placeholder="What works, what doesn't…"></textarea>
        <div id="moreWrap" style="margin-top:8px"></div>
      </div>
      <div class="sect">
        <h2>Pins <span id="pinCount" style="text-transform:none;letter-spacing:0"></span></h2>
        <div id="pinlist"><div class="empty">Switch to <b>Pin</b> and click the design — drag to mark a region.</div></div>
      </div>
      <div class="sect">
        <h2>Next round</h2>
        <div class="fieldlbl">Overall direction</div>
        <textarea id="overall" placeholder="What should the next round do?"></textarea>
        <div class="fieldlbl" id="remixLbl">Remix</div>
        <div class="inline" id="remixRow">
          layout <select id="remixLayout"></select>
          colors <select id="remixColors"></select>
        </div>
        <input type="text" id="remixNote" placeholder="remix note (optional)" style="margin-top:6px" />
        <div class="inline" style="margin-top:10px">
          <button class="btn" id="iterateBtn">Regenerate</button>
          <button class="btn" id="remixBtn">Remix</button>
          <span class="hint">sends feedback-pending.json</span>
        </div>
      </div>
    </div>
    <div class="dock">
      <div id="approveForm">
        <div class="inline">We'll run with <select id="approveSel"></select></div>
        <button class="btn primary block" id="submitBtn">Approve &amp; submit feedback</button>
        <div class="hint" style="margin-top:6px">writes feedback.json — then return to your coding agent</div>
      </div>
      <div class="receipt" id="receipt">
        <span class="check">✓</span>
        <div><b>Feedback submitted</b> <span id="receiptMeta" class="meta"></span><br>
        <span class="meta">return to your coding agent and tell it you're done</span></div>
      </div>
    </div>
  </aside>
</div>
</div>

<script>
var CFG = /* GENERATOR:config */ ${embedJson(cfg)};
(function () {
  'use strict';
  var hasHtml = CFG.variants.some(function (v) { return v.type === 'html'; });
  var state = { ratings:{}, comments:{}, pins:[], sel:0, railSel:[], lastReloadGen:null,
                pinMode: !hasHtml, diff:null };
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function cur() { return CFG.variants[state.sel]; }

  // ── mode (Interact ↔ Pin) ─────────────────────────────────────────────
  var segI = document.getElementById('m-interact');
  var segP = document.getElementById('m-pin');
  function applyMode() {
    segI.classList.toggle('on', !state.pinMode);
    segP.classList.toggle('on', state.pinMode);
    var layer = document.querySelector('.pinlayer');
    if (layer) layer.classList.toggle('pass', !state.pinMode);
    document.getElementById('modeHint').textContent = state.pinMode
      ? 'click to pin · drag to mark a region'
      : (cur() && cur().type === 'html' ? 'pan / zoom freely — Pin to annotate' : '');
  }
  segI.onclick = function () { state.pinMode = false; applyMode(); };
  segP.onclick = function () { state.pinMode = true; applyMode(); };

  // ── rails toggle ──────────────────────────────────────────────────────
  function toggleRail(which) {
    var r = document.getElementById(which === 'L' ? 'railL' : 'railR');
    var b = document.getElementById(which === 'L' ? 'tgL' : 'tgR');
    r.classList.toggle('closed');
    b.classList.toggle('off', r.classList.contains('closed'));
  }
  document.getElementById('tgL').onclick = function () { toggleRail('L'); };
  document.getElementById('tgR').onclick = function () { toggleRail('R'); };

  document.addEventListener('keydown', function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === 'p') { state.pinMode = !state.pinMode; applyMode(); }
    if (k === '[') toggleRail('L');
    if (k === ']') toggleRail('R');
    if (e.key === 'ArrowLeft' && CFG.variants.length > 1) select(state.sel - 1);
    if (e.key === 'ArrowRight' && CFG.variants.length > 1) select(state.sel + 1);
  });

  // ── export (PNG reference image / HTML handoff) ───────────────────────
  // Self-contained rasteriser, the same pipeline the canvas uses: clone the
  // node with computed styles + @font-face + <img> urls inlined, wrap in
  // foreignObject→canvas (≤3×) for PNG. Everything derives from the node's OWN
  // document, so it operates on an element inside the same-origin artifact
  // iframe. PNG is a REFERENCE image; the HTML (+ design-spec.md) is the real
  // design→implementation handoff — the menu copy says so.
  function domExport(node, w, h, name, kind) {
    var doc = node.ownerDocument, win = doc.defaultView || window;
    var ready = (doc.fonts && doc.fonts.ready) ? doc.fonts.ready.catch(function () {}) : Promise.resolve();
    var toDataURL = function (url) {
      return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result); };
          fr.onerror = function () { res(url); };
          fr.readAsDataURL(b);
        });
      }).catch(function () { return url; });
    };
    var save = function (blob, ext) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name + '.' + ext; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    return ready.then(function () {
      var fontRules = [], pending = [], seen = {};
      var scrapeCss = function (href) {
        if (seen[href]) return; seen[href] = 1;
        pending.push(fetch(href).then(function (r) { return r.text(); }).then(function (css) {
          (css.match(/@font-face\\s*{[^}]*}/g) || []).forEach(function (m) { fontRules.push({ css: m, base: href }); });
        }).catch(function () {}));
      };
      var sheets = doc.styleSheets;
      for (var i = 0; i < sheets.length; i++) {
        var ss = sheets[i], base = ss.href || doc.baseURI;
        try {
          var rules = ss.cssRules;
          for (var j = 0; j < rules.length; j++) if (rules[j].type === 5) fontRules.push({ css: rules[j].cssText, base: base });
        } catch (e) { if (ss.href) scrapeCss(ss.href); }
      }
      return Promise.all(pending).then(function () {
        return Promise.all(fontRules.map(function (rule) {
          var out = rule.css, m, re = /url\\((['"]?)([^'")]+)\\1\\)/g, urls = [];
          while ((m = re.exec(rule.css))) { if (m[2].indexOf('data:') !== 0) urls.push(m); }
          var chain = Promise.resolve();
          urls.forEach(function (mm) {
            chain = chain.then(function () {
              var abs; try { abs = new URL(mm[2], rule.base).href; } catch (e) { return; }
              return toDataURL(abs).then(function (d) { out = out.split(mm[0]).join('url("' + d + '")'); });
            });
          });
          return chain.then(function () { return out; });
        }));
      }).then(function (fontList) {
        var fontCss = fontList.join('\\n');
        var cloneStyled = function (src) {
          if (src.nodeType === 8 || (src.nodeType === 1 && src.tagName === 'SCRIPT')) return doc.createTextNode('');
          var dst = src.cloneNode(false);
          if (src.nodeType === 1) {
            var cs = win.getComputedStyle(src), txt = '';
            for (var i = 0; i < cs.length; i++) txt += cs[i] + ':' + cs.getPropertyValue(cs[i]) + ';';
            dst.setAttribute('style', txt + 'animation:none;transition:none;');
            if (src.tagName === 'CANVAS') { try { var im = doc.createElement('img'); im.src = src.toDataURL(); im.setAttribute('style', txt); return im; } catch (e) {} }
          }
          for (var c = src.firstChild; c; c = c.nextSibling) dst.appendChild(cloneStyled(c));
          return dst;
        };
        var clone = cloneStyled(node);
        clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        clone.style.boxShadow = 'none'; clone.style.borderRadius = '0';
        var jobs = [];
        clone.querySelectorAll('img').forEach(function (im) {
          var s = im.getAttribute('src');
          if (s && s.indexOf('data:') !== 0) {
            try { var abs = new URL(s, doc.baseURI).href; jobs.push(toDataURL(abs).then(function (d) { im.setAttribute('src', d); })); } catch (e) {}
          }
        });
        return Promise.all(jobs).then(function () {
          var xml = new XMLSerializer().serializeToString(clone);
          if (kind === 'html') {
            var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + name + '</title>' +
              (fontCss ? '<style>' + fontCss + '</style>' : '') + '</head><body style="margin:0">' + xml + '</body></html>';
            return save(new Blob([html], { type: 'text/html' }), 'html');
          }
          var px = Math.max(1, Math.min(3, Math.floor(11000 / Math.max(w, h)) || 1));
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (w * px) + '" height="' + (h * px) +
            '" viewBox="0 0 ' + w + ' ' + h + '"><foreignObject width="' + w + '" height="' + h + '">' +
            (fontCss ? '<style><![CDATA[' + fontCss + ']]></style>' : '') + xml + '</foreignObject></svg>';
          var img = new Image();
          return new Promise(function (res, rej) {
            img.onload = res; img.onerror = function () { rej(new Error('render failed')); };
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          }).then(function () {
            var cv = document.createElement('canvas'); cv.width = w * px; cv.height = h * px;
            cv.getContext('2d').drawImage(img, 0, 0);
            cv.toBlob(function (blob) { save(blob, 'png'); }, 'image/png');
          });
        });
      });
    });
  }

  function exportName(suffix) {
    var v = cur();
    var base = (CFG.boardId || 'design') + (v && v.id && v.id !== 'artifact' ? '-' + v.id : '');
    return (base + (suffix ? '-' + suffix : '')).replace(/[^\\w.-]+/g, '_');
  }
  function currentScreenEl() {
    var m = state.media;
    if (!m || m.tagName !== 'IFRAME') return null;
    try {
      var doc = m.contentDocument;
      var node = doc.elementFromPoint(m.clientWidth / 2, m.clientHeight / 2);
      while (node && node !== doc.documentElement) {
        if ((node.dataset && (node.dataset.dcSlot || node.dataset.screen)) || (node.tagName === 'SECTION' && node.id)) return node;
        node = node.parentElement;
      }
      return doc.body;
    } catch (e) { return null; }
  }
  function downloadSrc(src, name) {
    var a = document.createElement('a'); a.href = src; a.download = name; a.click();
  }
  function toast(text) {
    banner('ok', text);
    setTimeout(function () { document.getElementById('banner').classList.remove('show'); }, 2800);
  }
  function exportRun(target) {
    closeMenu();
    var v = cur();
    if (target === 'html-file') { downloadSrc(v.src, exportName('') + '.html'); return; }
    if (target === 'src') { downloadSrc(v.src, exportName('') + (/\\.svg(\\?|$)/.test(v.src) ? '.svg' : '.png')); return; }
    var node, w, h, label;
    if (target === 'screen') {
      node = currentScreenEl();
      if (!node) { toast('No screen under the viewport to export.'); return; }
      w = node.offsetWidth || node.scrollWidth; h = node.offsetHeight || node.scrollHeight;
      label = (node.dataset && (node.dataset.dcSlot || node.dataset.screen)) || node.id || 'screen';
    } else {
      if (!state.media || state.media.tagName !== 'IFRAME') { toast('Nothing to rasterise.'); return; }
      var d = state.media.contentDocument;
      node = d.body;
      w = Math.max(d.documentElement.scrollWidth, d.body.scrollWidth);
      h = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight);
      label = 'full';
    }
    toast('Rendering PNG…');
    domExport(node, w, h, exportName(label), 'png')
      .then(function () { toast('PNG downloaded — reference image (HTML + design-spec.md is the real handoff).'); })
      .catch(function (e) { toast('Export failed: ' + (e && e.message ? e.message : e)); });
  }

  var exportMenu = document.getElementById('exportMenu');
  function closeMenu() { exportMenu.hidden = true; }
  function buildMenu() {
    var v = cur();
    exportMenu.innerHTML = '';
    var add = function (label, fn) { var b = el('button', '', label); b.onclick = fn; exportMenu.appendChild(b); };
    if (v.type === 'html') {
      add('PNG — current screen', function () { exportRun('screen'); });
      add('PNG — full design', function () { exportRun('full'); });
      exportMenu.appendChild(el('div', 'sep'));
      add('HTML — download artifact', function () { exportRun('html-file'); });
      exportMenu.appendChild(el('div', 'mhint', 'PNG is a reference image. The HTML (+ design-spec.md) is the real design→build handoff.'));
    } else {
      add('Download ' + (/\\.svg(\\?|$)/.test(v.src) ? 'SVG' : 'PNG'), function () { exportRun('src'); });
      exportMenu.appendChild(el('div', 'mhint', 'Reference image for sharing.'));
    }
  }
  document.getElementById('btnExport').onclick = function (e) {
    e.stopPropagation();
    if (exportMenu.hidden) { buildMenu(); exportMenu.hidden = false; } else closeMenu();
  };
  document.addEventListener('click', function () { closeMenu(); });

  // ── left rail: variants ───────────────────────────────────────────────
  var vlist = document.getElementById('vlist');
  CFG.variants.forEach(function (v, i) {
    var it = el('div', 'vitem');
    it.dataset.variant = v.id;
    var tb = v.type === 'image' ? '<img src="' + v.src + '" alt="">'
           : v.type === 'svg' ? '<object type="image/svg+xml" data="' + v.src + '"></object>'
           : '◈';
    it.innerHTML = '<span class="thumb">' + tb + '</span>' +
      '<span class="nm"><b>' + (v.id === 'artifact' ? 'Artifact' : v.id) + '</b><span>' + (v.label || '') + '</span></span>' +
      '<span class="st"></span>';
    it.onclick = function () { select(i); };
    vlist.appendChild(it);
  });

  function select(i) {
    state.sel = (i + CFG.variants.length) % CFG.variants.length;
    state.diff = null;
    document.querySelectorAll('.vitem').forEach(function (x, j) { x.classList.toggle('on', j === state.sel); });
    document.querySelectorAll('.verthumb').forEach(function (x) { x.classList.remove('sel'); });
    state.railSel = [];
    renderStage();
    renderInspector();
  }

  // ── stage ─────────────────────────────────────────────────────────────
  var stagein = document.getElementById('stagein');
  function renderStage() {
    var v = cur();
    stagein.innerHTML = '';
    state.media = null;
    stagein.className = 'stagein' + (v.type === 'html' ? ' fillwrap' : '');

    if (state.diff) {
      var d = el('div', 'frame');
      d.style.maxWidth = '920px';
      d.innerHTML = '<div class="diffwrap"><img src="' + state.diff[0] + '" alt="base">' +
        '<div class="topimg"><img src="' + state.diff[1] + '" alt="compare"></div>' +
        '<input type="range" min="0" max="100" value="50"></div>';
      stagein.appendChild(d);
      d.querySelector('input').oninput = function () {
        d.querySelector('.topimg').style.clipPath = 'inset(0 ' + (100 - this.value) + '% 0 0)';
      };
      updatePager('A / B compare');
      return;
    }

    var frame = el('div', 'frame' + (v.type === 'html' ? ' fill' : ''));
    var media;
    if (v.type === 'html') { media = el('iframe'); media.src = v.src; }
    else if (v.type === 'svg') { media = el('object'); media.type = 'image/svg+xml'; media.data = v.src; }
    else { media = el('img'); media.src = v.src; media.alt = v.id; }
    frame.appendChild(media);
    state.media = media;
    var layer = el('div', 'pinlayer');
    frame.appendChild(layer);
    stagein.appendChild(frame);
    attachPinLayer(layer, media, v);
    drawPins(layer, v.id);
    // anchored pins track the content through pan/zoom/scroll
    if (state.trackTimer) clearInterval(state.trackTimer);
    if (v.type === 'html') {
      state.trackTimer = setInterval(function () { positionPins(layer, v.id); }, 120);
    }
    applyMode();
    updatePager((v.id === 'artifact' ? 'Artifact' : v.id) + (v.label ? ' · ' + v.label : ''));
  }
  function updatePager(label) {
    var bar = document.getElementById('stagebar');
    if (CFG.variants.length > 1) {
      bar.hidden = false;
      document.getElementById('pgLabel').textContent = label + '  ·  ' + (state.sel + 1) + ' / ' + CFG.variants.length;
    } else bar.hidden = true;
  }
  document.getElementById('pgPrev').onclick = function () { select(state.sel - 1); };
  document.getElementById('pgNext').onclick = function () { select(state.sel + 1); };

  // ── pins ──────────────────────────────────────────────────────────────
  // For iframe artifacts, pins are CONTENT-ANCHORED: coordinates are stored
  // relative to the screen/artboard element under the click (a canvas artboard
  // is [data-dc-slot]; walkthroughs use <section id>/[data-screen]). Those
  // ratios are invariant under pan/zoom/scroll, so the pin means the same spot
  // no matter the viewport state — and markers track the content live.
  // Images/SVGs keep plain layer-relative ratios (the media IS the content).
  function attachPinLayer(layer, media, variant) {
    var down = null;
    layer.addEventListener('mousedown', function (e) {
      if (e.target.closest('.pin') || e.target.closest('.popover')) return;
      var r = layer.getBoundingClientRect();
      down = { x: e.clientX - r.left, y: e.clientY - r.top, anchor: anchorAt(media, e) };
    });
    layer.addEventListener('mouseup', function (e) {
      if (!down) return;
      var r = layer.getBoundingClientRect();
      var up = { x: e.clientX - r.left, y: e.clientY - r.top };
      var box, anchor = down.anchor;
      if (anchor) {
        // anchor-space ratios: the layer box coincides with the iframe viewport,
        // so element rects from the iframe document map 1:1 onto layer coords.
        var ar = anchor.rect;
        box = {
          x: (Math.min(down.x, up.x) - ar.left) / ar.width,
          y: (Math.min(down.y, up.y) - ar.top) / ar.height,
          w: Math.abs(up.x - down.x) / ar.width,
          h: Math.abs(up.y - down.y) / ar.height,
        };
        if (Math.abs(up.x - down.x) < 8 && Math.abs(up.y - down.y) < 8) { box.w = 0; box.h = 0; }
        box.x = Math.min(1, Math.max(0, box.x)); box.y = Math.min(1, Math.max(0, box.y));
      } else {
        box = {
          x: Math.min(down.x, up.x) / r.width,
          y: Math.min(down.y, up.y) / r.height,
          w: Math.abs(up.x - down.x) / r.width,
          h: Math.abs(up.y - down.y) / r.height,
        };
        if (box.w * r.width < 8 && box.h * r.height < 8) { box.w = 0; box.h = 0; }
      }
      down = null;
      openPopover(layer, box, variant.id, anchor ? anchor.id : undefined, up);
    });
  }
  // Nearest content anchor under the pointer: canvas artboard [data-dc-slot],
  // then [data-screen], then <section id>. Returns { id, el, rect } or null.
  function anchorAt(media, e) {
    try {
      if (media.tagName !== 'IFRAME') return null;
      var doc = media.contentDocument;
      var ir = media.getBoundingClientRect();
      var node = doc.elementFromPoint(e.clientX - ir.left, e.clientY - ir.top);
      while (node && node !== doc.documentElement) {
        var id = (node.dataset && (node.dataset.dcSlot || node.dataset.screen)) ||
                 (node.tagName === 'SECTION' && node.id ? node.id : null);
        if (id) return { id: id, el: node, rect: node.getBoundingClientRect() };
        node = node.parentElement;
      }
    } catch (err) { /* cross-origin — fall back to layer-relative coords */ }
    return null;
  }
  // Re-find an anchor element by id inside the iframe document.
  function anchorEl(media, id) {
    try {
      var doc = media.contentDocument;
      return doc.querySelector('[data-dc-slot="' + id + '"]') ||
             doc.getElementById(id) ||
             doc.querySelector('[data-screen="' + id + '"]');
    } catch (err) { return null; }
  }
  function openPopover(layer, box, variantId, screen, at) {
    document.querySelectorAll('.popover').forEach(function (p) { p.remove(); });
    var pop = el('div', 'popover');
    var lr = layer.getBoundingClientRect();
    var px = at ? at.x : box.x * lr.width;
    var py = at ? at.y : box.y * lr.height;
    pop.style.left = Math.max(8, Math.min(px, lr.width - 280)) + 'px';
    pop.style.top = Math.max(8, Math.min(py, lr.height - 180)) + 'px';
    if (screen) pop.appendChild(el('div', 'hint', 'screen: ' + screen));
    var ta = el('textarea'); ta.placeholder = 'What should change here?';
    var sel = el('select', '', '<option value="fix">fix</option><option value="improve">improve</option><option value="question">question</option>');
    var row = el('div', 'row');
    var ok = el('button', 'btn primary', 'Pin it');
    var cancel = el('button', 'btn', 'Cancel');
    ok.onclick = function () {
      if (!ta.value.trim()) { ta.focus(); return; }
      var pin = { variant: screen || variantId, x: box.x, y: box.y, w: box.w, h: box.h,
                  comment: ta.value.trim(), intent: sel.value, _v: variantId };
      if (screen) pin.screen = screen;
      state.pins.push(pin);
      pop.remove();
      drawPins(layer, variantId);
      renderPinList();
    };
    cancel.onclick = function () { pop.remove(); };
    row.appendChild(ok); row.appendChild(cancel);
    pop.appendChild(ta); pop.appendChild(sel); pop.appendChild(row);
    layer.appendChild(pop);
    ta.focus();
  }
  function drawPins(layer, variantId) {
    layer.querySelectorAll('.pin,.region').forEach(function (x) { x.remove(); });
    state.pins.forEach(function (pin, idx) {
      if (pin._v !== variantId) return;
      if (pin.w > 0 || pin.h > 0) {
        var reg = el('div', 'region');
        reg.dataset.idx = idx;
        layer.appendChild(reg);
      }
      var marker = el('div', 'pin');
      marker.dataset.idx = idx;
      marker.title = '[' + pin.intent + '] ' + pin.comment;
      marker.appendChild(el('div', 'pd', '<span>' + (idx + 1) + '</span>'));
      layer.appendChild(marker);
    });
    positionPins(layer, variantId);
  }
  // Place markers/regions: anchored pins resolve their element's CURRENT rect
  // (tracks pan/zoom/scroll); plain pins use layer ratios. Runs on a light
  // interval while an iframe artifact is on stage.
  function positionPins(layer, variantId) {
    var media = layer.parentNode ? layer.parentNode.querySelector('iframe,img,object') : null;
    state.pins.forEach(function (pin, idx) {
      if (pin._v !== variantId) return;
      var marker = layer.querySelector('.pin[data-idx="' + idx + '"]');
      var reg = layer.querySelector('.region[data-idx="' + idx + '"]');
      var left, top, w, h, visible = true;
      if (pin.screen && media && media.tagName === 'IFRAME') {
        var a = anchorEl(media, pin.screen);
        if (a) {
          var r = a.getBoundingClientRect(); // iframe viewport coords == layer coords
          left = r.left + pin.x * r.width; top = r.top + pin.y * r.height;
          w = pin.w * r.width; h = pin.h * r.height;
          var lr = layer.getBoundingClientRect();
          visible = left > -40 && top > -40 && left < lr.width + 40 && top < lr.height + 40;
        } else visible = false;
        if (marker) {
          marker.style.left = left + 'px'; marker.style.top = top + 'px';
          marker.style.display = visible ? '' : 'none';
        }
        if (reg) {
          reg.style.left = left + 'px'; reg.style.top = top + 'px';
          reg.style.width = w + 'px'; reg.style.height = h + 'px';
          reg.style.display = visible ? '' : 'none';
        }
      } else {
        if (marker) { marker.style.left = (pin.x * 100) + '%'; marker.style.top = (pin.y * 100) + '%'; }
        if (reg) {
          reg.style.left = (pin.x * 100) + '%'; reg.style.top = (pin.y * 100) + '%';
          reg.style.width = (pin.w * 100) + '%'; reg.style.height = (pin.h * 100) + '%';
        }
      }
    });
  }
  function renderPinList() {
    var list = document.getElementById('pinlist');
    document.getElementById('pinCount').textContent = state.pins.length ? '· ' + state.pins.length : '';
    if (!state.pins.length) {
      list.innerHTML = '<div class="empty">Switch to <b>Pin</b> and click the design — drag to mark a region.</div>';
      return;
    }
    list.innerHTML = '';
    state.pins.forEach(function (pin, idx) {
      var row = el('div', 'pinrow');
      row.innerHTML = '<span class="n">' + (idx + 1) + '</span>' +
        '<span class="tx"><span class="it">' + pin.intent + '</span>' + pin.comment.replace(/</g, '&lt;') +
        (pin.screen ? '<br><span class="sc">screen: ' + pin.screen + '</span>' : '') + '</span>' +
        '<button class="del" title="remove pin">×</button>';
      row.onclick = function (e) {
        if (e.target.classList.contains('del')) {
          state.pins.splice(idx, 1);
          var layer = document.querySelector('.pinlayer');
          if (layer) drawPins(layer, cur().id);
          renderPinList();
          return;
        }
        var vi = CFG.variants.findIndex(function (v) { return v.id === pin._v; });
        if (vi >= 0 && vi !== state.sel) select(vi);
        var m = document.querySelector('.pin[data-idx="' + idx + '"]');
        if (m) { m.classList.add('hl'); setTimeout(function () { m.classList.remove('hl'); }, 900); m.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      };
      list.appendChild(row);
    });
  }

  // ── inspector (per-selection) ─────────────────────────────────────────
  var stars = document.getElementById('stars');
  for (var s = 1; s <= 5; s++) (function (n) {
    var b = el('button', '', '★');
    b.setAttribute('aria-label', n + ' star' + (n > 1 ? 's' : ''));
    b.onclick = function () { state.ratings[cur().id] = n; paintStars(); };
    stars.appendChild(b);
  })(s);
  function paintStars() {
    var n = state.ratings[cur().id] || 0;
    Array.prototype.forEach.call(stars.children, function (c, i) { c.classList.toggle('on', i < n); });
  }
  var notes = document.getElementById('notes');
  notes.oninput = function () { state.comments[cur().id] = notes.value; };
  function renderInspector() {
    document.getElementById('selName').textContent = '· ' + (cur().id === 'artifact' ? 'artifact' : cur().id);
    paintStars();
    notes.value = state.comments[cur().id] || '';
    var mw = document.getElementById('moreWrap');
    mw.innerHTML = '';
    if (CFG.mode === 'loop') {
      var more = el('button', 'btn block', 'More like ' + cur().id);
      more.onclick = function () { sendPending('more-like', { preferred: cur().id }); };
      mw.appendChild(more);
    }
  }

  // ── selectors ─────────────────────────────────────────────────────────
  ['remixLayout', 'remixColors', 'approveSel'].forEach(function (id) {
    var sel = document.getElementById(id);
    CFG.variants.forEach(function (v) {
      var o = document.createElement('option'); o.value = v.id; o.textContent = v.id; sel.appendChild(o);
    });
  });
  if (CFG.variants.length < 2) {
    document.getElementById('remixRow').style.display = 'none';
    document.getElementById('remixLbl').style.display = 'none';
    document.getElementById('remixBtn').style.display = 'none';
    document.getElementById('remixNote').style.display = 'none';
  }

  // ── handshake ─────────────────────────────────────────────────────────
  function cleanPins() {
    return state.pins.map(function (p) {
      var q = {}; Object.keys(p).forEach(function (k) { if (k !== '_v') q[k] = p[k]; });
      return q;
    });
  }
  function payload(extra) {
    var base = {
      schema_version: '1.0.0',
      boardId: CFG.boardId,
      publishedAt: new Date().toISOString(),
      ratings: state.ratings,
      comments: state.comments,
      overall: document.getElementById('overall').value || '',
      regenerated: false,
      pins: cleanPins(),
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
  function banner(kind, text) {
    var b = document.getElementById('banner');
    document.getElementById('bannerBadge').textContent = kind === 'ok' ? '✓' : '↻';
    document.getElementById('bannerText').textContent = text;
    b.classList.add('show');
  }
  function sendPending(action, extra) {
    var fb = payload(extra);
    fb.regenerated = true;
    fb.regenerateAction = action;
    post('pending', fb, function () {
      banner('pending', 'Sent to your agent (' + action + ' · ' + summary(fb) + ') — this tab reloads when the new round lands.');
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
      banner('ok', 'Feedback received — feedback.json written next to the board. Return to your coding agent.');
      document.title = '✓ ' + document.title;
    });
  };

  // ── progress / versions / reload ──────────────────────────────────────
  function applyProgress(p) {
    (p.variants ? Object.keys(p.variants) : []).forEach(function (vid) {
      var it = document.querySelector('.vitem[data-variant="' + vid + '"] .st');
      if (!it) return;
      var st = p.variants[vid];
      it.className = 'st ' + st;
      it.innerHTML = st === 'generating' || st === 'checking' || st === 'queued'
        ? '<span class="spin"></span>'
        : st === 'failed' ? '✗' : st === 'done' ? '✓' : st;
    });
    if (p.versions && Object.keys(p.versions).some(function (k) { return (p.versions[k] || []).length; })) {
      renderVersions(p.versions);
    }
    if (state.lastReloadGen === null) state.lastReloadGen = p.reloadGen;
    else if (p.reloadGen !== state.lastReloadGen) location.reload();
  }
  function renderVersions(versions) {
    var box = document.getElementById('vers');
    document.getElementById('versSect').hidden = false;
    box.innerHTML = '';
    Object.keys(versions).forEach(function (vid) {
      versions[vid].forEach(function (file, i) {
        var t = el('div', 'verthumb');
        t.dataset.file = file;
        t.innerHTML = '<span class="vt">' + (/\\.svg$/.test(file)
          ? '<object type="image/svg+xml" data="' + file + '"></object>'
          : '<img src="' + file + '" alt="">') + '</span>' + vid + ' · v' + (i + 1);
        t.onclick = function () {
          var ix = state.railSel.indexOf(t);
          if (ix >= 0) state.railSel.splice(ix, 1); else state.railSel.push(t);
          while (state.railSel.length > 2) state.railSel.shift();
          document.querySelectorAll('.verthumb').forEach(function (x) { x.classList.remove('sel'); });
          state.railSel.forEach(function (x) { x.classList.add('sel'); });
          if (state.railSel.length === 2) {
            state.diff = [state.railSel[0].dataset.file, state.railSel[1].dataset.file];
            renderStage();
          } else if (state.diff) { state.diff = null; renderStage(); }
        };
        box.appendChild(t);
      });
    });
  }
  function poll() {
    fetch('api/progress').then(function (r) { return r.json(); }).then(applyProgress).catch(function () {});
  }
  setInterval(poll, 1500);
  poll();

  select(0);
})();
</script>
</body>
</html>
`;
}
