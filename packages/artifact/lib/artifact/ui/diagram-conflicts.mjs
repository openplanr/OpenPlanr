import { diffDiagramBundles } from '../diagram/authoring/index.mjs';
import { button, downloadJson, element } from './diagram-editor-dom.mjs';

/** One comparison surface for local and company adapters. Choices never auto-save. */
export function mountDiagramConflicts({ root, session, onClose = () => {}, onError = () => {} }) {
  const document = root.ownerDocument;
  const state = session.getState(),
    comparison = state.comparison;
  if (!comparison || !state.bundle) return { dispose() {} };
  const { base, bundle: current } = comparison;
  const pending = state.bundle;
  const panel = element(document, 'section', {
    className: 'de-conflict',
    'aria-label': 'Compare conflicting changes',
  });
  panel.append(
    element(document, 'h2', {}, 'Review conflicting changes'),
    element(
      document,
      'p',
      {},
      'The saved diagram changed. Your draft is retained. Compare changes before choosing what to keep.',
    ),
  );
  const rows = new Map();
  for (const [side, value] of [
    ['current', current],
    ['draft', pending],
  ]) {
    const diff = diffDiagramBundles(base, value);
    if (!diff.ok) {
      onError(diff);
      return { dispose() {} };
    }
    for (const dimension of ['semantic', 'presentation'])
      for (const change of diff[dimension]) {
        const key = JSON.stringify([dimension, change.collection, change.elementId, change.path]);
        if (!rows.has(key))
          rows.set(key, {
            dimension,
            change,
            base: change.before,
            current: change.before,
            draft: change.before,
          });
        rows.get(key)[side] = change.after;
      }
  }
  const table = element(document, 'table');
  const header = element(document, 'tr');
  for (const title of ['Change', 'Base', 'Current', 'Your draft'])
    header.append(element(document, 'th', { scope: 'col' }, title));
  const thead = element(document, 'thead');
  thead.append(header);
  table.append(thead);
  const tbody = element(document, 'tbody');
  const readable = (value) =>
    value === null
      ? 'Removed / absent'
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  for (const row of [...rows.values()].slice(0, 200)) {
    const tr = element(document, 'tr');
    tr.append(
      element(
        document,
        'th',
        { scope: 'row' },
        `${row.dimension === 'semantic' ? 'Meaning' : 'Layout'} · ${row.change.elementId ?? 'Diagram'} · ${row.change.path.join('.') || row.change.collection}`,
      ),
    );
    for (const side of ['base', 'current', 'draft'])
      tr.append(element(document, 'td', {}, readable(row[side])));
    tbody.append(tr);
  }
  table.append(tbody);
  const scroll = element(document, 'div', {
    className: 'de-comparison-scroll',
    tabindex: '0',
    'aria-label': 'Change comparison',
  });
  scroll.append(table);
  panel.append(scroll);
  if (!rows.size)
    panel.append(
      element(
        document,
        'p',
        {},
        'The content matches the saved revision. Retry Save to confirm the pending transaction.',
      ),
    );
  if (rows.size > 200)
    panel.append(
      element(
        document,
        'p',
        {},
        `Showing 200 of ${rows.size} changes. Download your complete draft before resolving.`,
      ),
    );
  const controls = element(document, 'div', { className: 'de-actions' });
  const keep = button(document, 'Keep my draft', 'keep-draft'),
    download = button(document, 'Download my draft', 'download-draft'),
    adopt = button(document, 'Use current revision…', 'use-current');
  controls.append(keep, download, adopt);
  panel.append(controls);
  const confirmation = element(document, 'div', { className: 'de-confirm', hidden: true });
  confirmation.append(
    element(
      document,
      'p',
      {},
      'Replace this local draft with the current saved revision? Pending edits and undo history will be removed. Download your draft first if you want to keep a copy.',
    ),
  );
  const confirm = button(document, 'Replace local draft', 'confirm-current'),
    cancel = button(document, 'Keep editing my draft', 'cancel-current');
  confirmation.append(confirm, cancel);
  panel.append(confirmation);
  root.replaceChildren(panel);
  const click = (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !panel.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'keep-draft') onClose();
    else if (action === 'download-draft')
      downloadJson(document, pending, `${pending.diagramId}.draft.planr-diagram-bundle.json`);
    else if (action === 'use-current') {
      confirmation.hidden = false;
      cancel.focus();
    } else if (action === 'cancel-current') {
      confirmation.hidden = true;
      adopt.focus();
    } else if (action === 'confirm-current') {
      const result = session.useAuthoritative();
      if (result.ok) onClose();
      else onError(result);
    }
  };
  panel.addEventListener('click', click);
  return {
    dispose() {
      panel.removeEventListener('click', click);
      panel.remove();
    },
  };
}
