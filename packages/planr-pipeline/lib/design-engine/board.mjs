/**
 * Board UI generator — ONE self-contained HTML file (inline CSS/JS, no CDN,
 * works offline, localhost only). The board is the CHOOSER; AskUserQuestion is
 * only the blocking wait (hard rule 2).
 *
 * Modes
 *   loop   — N variant cards (png/svg/html), each with stars, comment,
 *            "More like this", and a PIN layer (click = point pin, drag = region).
 *   review — ONE artifact iframe (finalized.html/canvas.html) with the pin layer
 *            mapping every pin to its nearest <section id> / [data-screen] —
 *            pins carry the SCREEN id so the agent regenerates exactly that part.
 *
 * Shared: versions rail (thumbnails per round; pick two → A/B slider diff),
 * live progress (polls /api/progress; file-driven), approve bar ("We'll run
 * with Option X"), overall textarea, remix panel. Submit → POST api/feedback
 * kind=submit (green confirmation); regenerate paths → kind=pending (orange).
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
  :root { --bg:#101318; --panel:#181d24; --line:#2a313c; --ink:#e8edf4; --muted:#9aa6b5;
          --accent:#5b7cfa; --ok:#2fbf71; --warn:#e8a13c; --pin:#ff5d5d; --radius:12px; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  header { position:sticky; top:0; z-index:40; display:flex; align-items:center; gap:16px;
           padding:12px 20px; background:var(--panel); border-bottom:1px solid var(--line); }
  header h1 { font-size:15px; margin:0; font-weight:600 }
  header .mode { font-size:11px; color:var(--muted); border:1px solid var(--line);
                 padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.08em }
  header .spacer { flex:1 }
  .banner { display:none; padding:10px 20px; font-weight:600 }
  .banner.ok { display:block; background:#10301f; color:var(--ok) }
  .banner.pending { display:block; background:#33270f; color:var(--warn) }
  main { padding:20px; display:grid; gap:20px }
  .grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)) }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); overflow:hidden }
  .card .head { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line) }
  .card .head .vid { font-weight:700; color:var(--accent) }
  .card .head .state { margin-left:auto; font-size:12px; color:var(--muted) }
  .state .spin { display:inline-block; width:10px; height:10px; border:2px solid var(--muted);
                 border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;
                 vertical-align:-1px; margin-right:6px }
  @keyframes spin { to { transform:rotate(360deg) } }
  .mediawrap { position:relative; background:#0a0c10 }
  .mediawrap img, .mediawrap object { display:block; width:100%; height:auto }
  .mediawrap iframe { display:block; width:100%; height:75vh; border:0; background:#fff }
  .pinlayer { position:absolute; inset:0; cursor:crosshair }
  .pin { position:absolute; transform:translate(-50%,-100%); z-index:5 }
  .pin .dot { width:22px; height:22px; border-radius:50% 50% 50% 0; background:var(--pin);
              color:#fff; font-size:11px; font-weight:700; display:flex; align-items:center;
              justify-content:center; transform:rotate(-45deg); box-shadow:0 2px 8px rgba(0,0,0,.5) }
  .pin .dot span { transform:rotate(45deg) }
  .region { position:absolute; border:2px dashed var(--pin); background:rgba(255,93,93,.12); z-index:4 }
  .popover { position:absolute; z-index:50; width:260px; background:var(--panel);
             border:1px solid var(--line); border-radius:10px; padding:10px; box-shadow:0 10px 36px rgba(0,0,0,.6) }
  .popover textarea { width:100%; min-height:54px }
  .popover .row { display:flex; gap:6px; margin-top:8px }
  .controls { padding:12px; display:grid; gap:10px; border-top:1px solid var(--line) }
  .stars { display:flex; gap:4px }
  .stars button { background:none; border:0; font-size:20px; cursor:pointer; color:#3d4654; padding:0 }
  .stars button.on { color:#f5c542 }
  textarea, select, input[type=text] { background:#0e1116; color:var(--ink); border:1px solid var(--line);
            border-radius:8px; padding:8px 10px; font:inherit; width:100% }
  button.btn { background:#222a36; color:var(--ink); border:1px solid var(--line); border-radius:8px;
               padding:8px 12px; font:inherit; cursor:pointer }
  button.btn:hover { border-color:var(--accent) }
  button.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600 }
  button.btn.subtle { font-size:12px; padding:6px 10px }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:14px;
           display:grid; gap:10px }
  .panel h2 { margin:0; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted) }
  .remixrow { display:flex; gap:10px; flex-wrap:wrap; align-items:center }
  .remixrow select { width:auto }
  .rail { display:flex; gap:10px; overflow-x:auto; padding-bottom:4px }
  .rail .thumb { flex:0 0 auto; width:120px; cursor:pointer; border:2px solid transparent; border-radius:8px;
                 overflow:hidden; background:#0a0c10 }
  .rail .thumb.sel { border-color:var(--accent) }
  .rail .thumb img, .rail .thumb object { width:100%; display:block; pointer-events:none }
  .rail .thumb .cap { font-size:11px; color:var(--muted); padding:3px 6px }
  .diff { position:relative; max-width:900px; border:1px solid var(--line); border-radius:10px; overflow:hidden }
  .diff img { display:block; width:100% }
  .diff .top { position:absolute; inset:0; overflow:hidden }
  .diff .top img { width:100%; }
  .diff input[type=range] { position:absolute; left:0; right:0; bottom:10px; width:100%; z-index:6 }
  .approve { position:sticky; bottom:0; z-index:40; display:flex; gap:12px; align-items:center;
             padding:14px 20px; background:var(--panel); border-top:1px solid var(--line) }
  .approve select { width:auto }
  .hint { color:var(--muted); font-size:12px }
</style>
</head>
<body>
<header>
  <h1>${title.replace(/</g, '&lt;')}</h1>
  <span class="mode">${mode}</span>
  <span class="spacer"></span>
  <span class="hint">click a design to pin a comment · drag to mark a region</span>
</header>
<div id="banner" class="banner"></div>
<main>
  <div class="grid" id="grid"></div>

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
      <input type="text" id="remixNote" placeholder="remix note (optional)" style="flex:1;min-width:200px" />
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
  <label>We'll run with
    <select id="approveSel"></select>
  </label>
  <button class="btn primary" id="submitBtn">Approve &amp; submit feedback</button>
  <span class="hint" id="approveHint">writes feedback.json — then return to your coding agent</span>
</div>

<script>
var CFG = /* GENERATOR:config */ ${embedJson(cfg)};
(function () {
  'use strict';
  var state = { ratings:{}, comments:{}, pins:[], railSel:[], lastReloadGen:null };
  var grid = document.getElementById('grid');
  var banner = document.getElementById('banner');

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  // ── variant cards ─────────────────────────────────────────────────────
  CFG.variants.forEach(function (v) {
    var card = el('div', 'card');
    card.dataset.variant = v.id;
    var head = el('div', 'head');
    head.appendChild(el('span', 'vid', v.id));
    head.appendChild(el('span', '', v.label || ''));
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
      b.onclick = function () {
        state.ratings[v.id] = n;
        Array.prototype.forEach.call(stars.children, function (c, i) { c.classList.toggle('on', i < n); });
      };
      stars.appendChild(b);
    })(s);
    controls.appendChild(stars);
    var comment = el('textarea');
    comment.placeholder = 'Notes on ' + v.id + '…';
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

  // ── pins (click = point, drag = region); review mode maps to screen ids ──
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

  // same-origin iframe: map a click to the nearest section[id] / [data-screen]
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
    pop.style.left = (box.x * 100) + '%';
    pop.style.top = (box.y * 100) + '%';
    var ta = el('textarea'); ta.placeholder = 'What should change here?';
    var sel = el('select', '', '<option value="fix">fix</option><option value="improve">improve</option><option value="question">question</option>');
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

  function sendPending(action, extra) {
    var fb = payload(extra);
    fb.regenerated = true;
    fb.regenerateAction = action;
    post('pending', fb, function () {
      banner.className = 'banner pending';
      banner.textContent = 'Sent to your agent (' + action + ') — keep this tab open; it reloads when the new round lands.';
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
    post('submit', fb, function () {
      banner.className = 'banner ok';
      banner.textContent = 'Feedback received! Return to your coding agent.';
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
    if (p.versions) renderRail(p.versions);
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
