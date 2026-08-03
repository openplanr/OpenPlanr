/**
 * empty-state.js — fresh-project empty state (SPEC-016 / T-006).
 *
 * design-spec §9 Screen #9: mark + message + command chip + CTA. Rendered by
 * the Overview view when GET /api/graph returns an empty graph.
 *
 * Token-only styling (ds.css). Icons are inline outline SVG (currentColor) per
 * design-spec §6 — never emoji. No raw hex, no off-grid spacing, no third-party
 * product codenames.
 */

const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';

const PLUS_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 5v14M5 12h14"/></svg>';

/** Build an element with class / html / text helper. */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const child of children) if (child) node.append(child);
  return node;
}

/**
 * Mount the empty state into `el`.
 * @param {HTMLElement} el content mount element
 */
export function mount(el2) {
  if (!el2) return;
  el2.innerHTML = '';

  const wrap = el('section', { class: 'ds-empty', attrs: { 'aria-label': 'No specs yet' } }, [
    el('div', { class: 'ds-empty__mark', html: FOLDER_ICON }),
    el('h1', { class: 'ds-empty__title', text: 'No specs yet' }),
    el('p', {
      class: 'ds-empty__msg',
      text: 'The dashboard reflects .planr/. Plan your first feature and it appears here — live.',
    }),
    el('code', { class: 'ds-empty__chip', text: '/planr-pipeline:plan <feature>' }),
  ]);

  const cta = el('button', {
    class: 'ds-btn',
    attrs: { type: 'button', 'data-action': 'new-spec' },
  }, [
    el('span', { html: PLUS_ICON }),
    el('span', { text: 'New spec' }),
  ]);
  cta.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('planr:new-spec'));
  });

  wrap.append(cta);
  el2.append(wrap);
}
