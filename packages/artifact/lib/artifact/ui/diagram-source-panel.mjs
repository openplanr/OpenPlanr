// @ts-check
import {
  adoptMermaidCopy,
  exportMermaidCopy,
  previewMermaidCopy,
  renderAuthoredDiagramSvg,
} from '../diagram/authoring/index.mjs';
import { button, element } from './diagram-editor-dom.mjs';

const MAX_SOURCE_BYTES = 65_536;
const SOURCE_LIMIT_MESSAGE = 'This source exceeds the 64 KiB import limit.';
const EMPTY_CALLBACK = () => {};
const ID_PREFIX = 'diagram-source';
let mountCount = 0;
const safeName = (name) => name.replace(/[^a-z0-9_-]/giu, '-').slice(0, 80) || 'diagram';
const fidelityName = (value) =>
  value === 'lossless' ? 'Preserved' : value === 'partial' ? 'Partial' : 'Unsupported';

function download(document, bytes, type, name) {
  const window = document.defaultView;
  const url = window.URL.createObjectURL(new window.Blob([bytes], { type }));
  const link = element(document, 'a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

function sourceOffset(source, displayedSource, byteOffset) {
  const bytes = new TextEncoder().encode(source);
  const prefix = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    bytes.subarray(0, byteOffset),
  );
  // Diagnostic ranges are byte-based on the exact retained source. Textarea
  // newline exposure differs across engines, so map the logical prefix onto the
  // control's actual value instead of assuming every engine normalizes to LF.
  const logicalOffset = prefix.replace(/\r\n?|\n/gu, '\n').length;
  let logicalIndex = 0;
  let displayedIndex = 0;
  while (displayedIndex < displayedSource.length && logicalIndex < logicalOffset) {
    if (displayedSource[displayedIndex] === '\r' && displayedSource[displayedIndex + 1] === '\n') {
      displayedIndex += 2;
    } else {
      displayedIndex++;
    }
    logicalIndex++;
  }
  return displayedIndex;
}

function sourceLineRange(source, lineNumber) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '\r' && source[index] !== '\n') continue;
    ranges.push({ start, end: index });
    if (source[index] === '\r' && source[index + 1] === '\n') index++;
    start = index + 1;
  }
  ranges.push({ start, end: source.length });
  return ranges[Math.max(0, Math.min(ranges.length - 1, (lineNumber ?? 1) - 1))];
}

function fidelity(document, report) {
  const wrap = element(document, 'div', {
    className: 'de-source-fidelity',
    'aria-label': 'Copy fidelity',
  });
  for (const [name, key] of [
    ['Meaning', 'semantic'],
    ['Authored layout', 'presentation'],
    ['Original source text', 'sourceText'],
  ]) {
    const row = element(document, 'div', {
      className: 'de-source-fidelity-row',
    });
    row.append(
      element(document, 'strong', {}, name),
      element(document, 'span', { 'data-fidelity': report[key] }, fidelityName(report[key])),
    );
    wrap.append(row);
  }
  if (report.losses.length) {
    const list = element(document, 'ul', {
      className: 'de-source-losses',
      'aria-label': 'Conversion losses',
    });
    for (const loss of report.losses)
      list.append(element(document, 'li', {}, `${loss.dimension}: ${loss.message}`));
    wrap.append(list);
  }
  return wrap;
}

/**
 * One inert copy-interchange panel shared by local and company editor hosts.
 * @type {typeof import('./diagram-source-panel.d.mts').mountDiagramSourcePanel}
 */
export function mountDiagramSourcePanel({
  root,
  session,
  source = '',
  initialTab = 'import',
  onSourceChange = EMPTY_CALLBACK,
  onBeforeAdopt = () => true,
  onNavigateElements = EMPTY_CALLBACK,
  onAdopt = EMPTY_CALLBACK,
  onClose,
  onReport = EMPTY_CALLBACK,
}) {
  if (
    !root?.ownerDocument ||
    !session ||
    typeof session.getState !== 'function' ||
    typeof session.adoptInitialCopy !== 'function'
  ) {
    throw new TypeError(
      'Source panel needs a root and an editor session that can adopt an initial copy.',
    );
  }
  if (!['import', 'export'].includes(initialTab))
    throw new TypeError('Initial source-panel tab must be import or export.');
  const document = root.ownerDocument;
  const standalone = !root.closest('.planr-diagram-editor');
  if (standalone) root.classList.add('planr-diagram-source-panel');
  // The first panel keeps the historical ids; later mounts take a suffix so two can share a document.
  mountCount += 1;
  const idPrefix = mountCount === 1 ? ID_PREFIX : `${ID_PREFIX}-${mountCount}`;
  const scopedId = (name) => `${idPrefix}-${name}`;
  const wrap = element(document, 'div', { className: 'de-source-panel' });
  root.replaceChildren(wrap);
  let preview = null;
  let acknowledgement = false;
  let disposed = false;
  let uploadGeneration = 0;
  let uploadPending = false;
  let rawSource = typeof source === 'string' ? source : '';
  const heading = element(document, 'h3', {}, 'Import a Mermaid copy');
  const explanation = element(
    document,
    'p',
    { className: 'de-muted' },
    'Paste or upload a flowchart copy. This does not link, watch, or overwrite a repository file. Review the proposed diagram before adopting it.',
  );
  const label = element(document, 'label', { className: 'de-field' });
  const textarea = element(document, 'textarea', {
    'aria-label': 'Mermaid source',
    spellcheck: 'false',
    rows: '10',
    className: 'de-source-input',
  });
  textarea.value = rawSource;
  const sourceLines = element(document, 'pre', {
    className: 'de-source-lines',
    'aria-hidden': 'true',
  });
  const sourceEditor = element(document, 'div', {
    className: 'de-source-editor',
  });
  const sourceWithinLimit = (value) =>
    value.length <= MAX_SOURCE_BYTES &&
    new TextEncoder().encode(value).byteLength <= MAX_SOURCE_BYTES;
  const updateLines = () => {
    if (!sourceWithinLimit(textarea.value)) {
      sourceLines.textContent = '…';
      return false;
    }
    sourceLines.textContent = Array.from(
      { length: textarea.value.split(/\r\n|\n|\r/u).length },
      (_, index) => String(index + 1),
    ).join('\n');
    return true;
  };
  sourceEditor.append(sourceLines, textarea);
  label.append(element(document, 'span', {}, 'Mermaid source'), sourceEditor);
  const upload = element(document, 'input', {
    type: 'file',
    accept: '.mmd,.mermaid,text/plain',
    'aria-label': 'Upload Mermaid copy',
  });
  const uploadLabel = element(document, 'label', { className: 'de-field' });
  uploadLabel.append(element(document, 'span', {}, 'Or choose a local Mermaid copy'), upload);
  const status = element(
    document,
    'p',
    { role: 'status', 'aria-live': 'polite', className: 'de-source-status' },
    'No source has been adopted.',
  );
  const panelError = element(document, 'p', {
    role: 'alert',
    className: 'de-source-error',
    hidden: true,
  });
  function clearError() {
    panelError.hidden = true;
    panelError.textContent = '';
    onReport('');
  }
  function showError(message) {
    panelError.textContent = message;
    panelError.hidden = false;
    onReport(message);
  }
  const actions = element(document, 'div', { className: 'de-actions' });
  const previewButton = button(document, 'Preview copy', 'source-preview', {
    className: 'de-primary',
  });
  const adoptButton = button(document, 'Adopt copy', 'source-adopt', {
    disabled: true,
  });
  actions.append(previewButton, adoptButton);
  const result = element(document, 'div', { className: 'de-source-result' });
  const exportHeading = element(document, 'h3', {}, 'Export a copy');
  const exportDescription = element(
    document,
    'p',
    { className: 'de-muted' },
    'The editable OpenPlanr bundle preserves the complete diagram. Mermaid and SVG are separate copies; neither updates an external source.',
  );
  const exportFormats = element(document, 'ul', {
    className: 'de-source-formats',
    'aria-label': 'Export format contents',
  });
  for (const text of [
    'Editable bundle — semantic document, authored presentation, original source, correspondence, and stable identity.',
    'Mermaid copy — certified flowchart meaning with the concrete formatting and layout losses shown below.',
    'SVG snapshot — visual-only output without editable semantics, original source, or correspondence.',
  ])
    exportFormats.append(element(document, 'li', {}, text));
  const exports = element(document, 'div', { className: 'de-actions' });
  exports.append(
    button(document, 'Download editable bundle', 'source-export-bundle'),
    button(document, 'Preview Mermaid export', 'source-export-preview'),
    button(document, 'Download SVG snapshot', 'source-export-svg'),
  );
  const exportResult = element(document, 'div', {
    className: 'de-source-result',
  });
  const tabs = element(document, 'div', {
    className: 'de-source-tabs',
    role: 'tablist',
    'aria-label': 'Mermaid copy options',
  });
  const importTab = button(document, 'Import a copy', 'source-import-tab', {
    id: scopedId('import-tab'),
    role: 'tab',
    'aria-selected': 'false',
    'aria-controls': scopedId('import-panel'),
    tabindex: '-1',
  });
  const exportTab = button(document, 'Export a copy', 'source-export-tab', {
    id: scopedId('export-tab'),
    role: 'tab',
    'aria-selected': 'false',
    'aria-controls': scopedId('export-panel'),
    tabindex: '-1',
  });
  tabs.append(importTab, exportTab);
  const importSection = element(document, 'section', {
    id: scopedId('import-panel'),
    role: 'tabpanel',
    'aria-labelledby': scopedId('import-tab'),
    className: 'de-source-section',
  });
  importSection.append(heading, explanation, label, uploadLabel, status, actions, result);
  const exportSection = element(document, 'section', {
    id: scopedId('export-panel'),
    role: 'tabpanel',
    'aria-labelledby': scopedId('export-tab'),
    className: 'de-source-section',
  });
  exportSection.append(exportHeading, exportDescription, exportFormats, exports, exportResult);
  const footer = element(document, 'div', { className: 'de-source-footer' });
  if (typeof onClose === 'function') footer.append(button(document, 'Close', 'source-close'));
  wrap.append(tabs, panelError, importSection, exportSection);
  if (footer.childElementCount) wrap.append(footer);
  function selectTab(next, { focus = false } = {}) {
    const importing = next === 'import';
    importSection.hidden = !importing;
    exportSection.hidden = importing;
    for (const [tab, selected] of [
      [importTab, importing],
      [exportTab, !importing],
    ]) {
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
  }
  selectTab(initialTab);
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const selected = importTab.getAttribute('aria-selected') === 'true' ? importTab : exportTab;
    const next =
      event.key === 'Home'
        ? importTab
        : event.key === 'End'
          ? exportTab
          : selected === importTab
            ? exportTab
            : importTab;
    selectTab(next === importTab ? 'import' : 'export', { focus: true });
  });

  function invalidate(nextSource, { invalidateUpload = true } = {}) {
    if (invalidateUpload) {
      uploadGeneration++;
      uploadPending = false;
      upload.value = '';
    }
    rawSource = nextSource;
    preview = null;
    acknowledgement = false;
    adoptButton.disabled = true;
    result.replaceChildren();
    const bounded = updateLines();
    previewButton.disabled = uploadPending || !bounded;
    if (!bounded) {
      status.textContent = SOURCE_LIMIT_MESSAGE;
      showError(SOURCE_LIMIT_MESSAGE);
    } else {
      clearError();
      status.textContent = uploadPending
        ? 'Loading the selected Mermaid copy.'
        : 'Source changed. Preview again before adoption.';
    }
    onSourceChange(rawSource);
  }
  const initialBounded = updateLines();
  previewButton.disabled = !initialBounded;
  if (!initialBounded) {
    status.textContent = SOURCE_LIMIT_MESSAGE;
    showError(SOURCE_LIMIT_MESSAGE);
  }
  textarea.addEventListener('input', () => {
    invalidate(textarea.value);
  });
  textarea.addEventListener('scroll', () => {
    sourceLines.scrollTop = textarea.scrollTop;
  });
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file) return;
    const generation = ++uploadGeneration;
    uploadPending = true;
    // Selecting another file invalidates any acknowledgement immediately. A
    // rejected file keeps the visible source, but can never adopt an older preview.
    invalidate(rawSource, { invalidateUpload: false });
    if (file.size > MAX_SOURCE_BYTES) {
      uploadPending = false;
      previewButton.disabled = !sourceWithinLimit(rawSource);
      status.textContent = SOURCE_LIMIT_MESSAGE;
      showError(status.textContent);
      upload.value = '';
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const content = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
      if (disposed || generation !== uploadGeneration) return;
      uploadPending = false;
      rawSource = content;
      textarea.value = rawSource;
      invalidate(rawSource, { invalidateUpload: false });
      status.textContent = `Loaded ${file.name} as an unlinked local copy. Preview before adoption.`;
    } catch {
      if (disposed || generation !== uploadGeneration) return;
      uploadPending = false;
      previewButton.disabled = !sourceWithinLimit(rawSource);
      status.textContent = 'This file is not valid UTF-8.';
      showError(status.textContent);
    }
    if (generation === uploadGeneration) upload.value = '';
  });
  function diagnosticList(items, { navigable = true } = {}) {
    const list = element(document, 'ol', {
      className: 'de-source-diagnostics',
      'aria-label': 'Source diagnostics',
    });
    items.forEach((item, index) => {
      const row = element(document, 'li');
      const level = item.severity === 'error' ? 'Error' : 'Notice';
      const location =
        Number.isInteger(item.line) && Number.isInteger(item.column)
          ? ` at line ${item.line}, column ${item.column}`
          : '';
      const message = `${level}${location}: ${item.message ?? item.detail ?? 'Review this conversion issue.'}`;
      row.append(
        navigable
          ? button(document, message, 'source-diagnostic', {
              'data-index': index,
            })
          : element(document, 'span', {}, message),
      );
      if (item.repair)
        row.append(element(document, 'span', { className: 'de-muted' }, item.repair));
      row.append(
        element(
          document,
          'span',
          { className: 'de-muted de-source-affected' },
          item.elementIds?.length
            ? `Affected object${item.elementIds.length === 1 ? '' : 's'}: ${item.elementIds.join(', ')}`
            : 'No object was created.',
        ),
      );
      list.append(row);
    });
    return list;
  }
  function showPreview() {
    if (uploadPending) return;
    if (!sourceWithinLimit(rawSource)) {
      previewButton.disabled = true;
      adoptButton.disabled = true;
      status.textContent = SOURCE_LIMIT_MESSAGE;
      showError(SOURCE_LIMIT_MESSAGE);
      return;
    }
    clearError();
    acknowledgement = false;
    adoptButton.disabled = true;
    const state = session.getState();
    const bundle = state.capabilities?.read ? state.bundle : null;
    if (!bundle) {
      status.textContent = 'Diagram access has changed.';
      showError(status.textContent);
      return;
    }
    const options = {
      diagramId: bundle.diagramId,
      title: bundle.document.title,
    };
    if (bundle.presentation.elements.length) options.previousBundle = bundle;
    preview = previewMermaidCopy(rawSource, options);
    result.replaceChildren();
    const diagnostics = preview.diagnostics ?? [];
    if (!preview.ok) {
      status.textContent = `Import rejected. ${diagnostics.filter((item) => item.severity === 'error').length} error(s); no diagram was changed.`;
      result.append(diagnosticList(diagnostics));
      showError(status.textContent);
      return;
    }
    const proposed = preview.bundle;
    status.textContent = `Preview ready: ${proposed.document.nodes.length} nodes, ${proposed.document.relations.length} connectors, ${proposed.document.groups.length} containers. No diagram was changed.`;
    result.append(fidelity(document, preview.fidelity));
    if (diagnostics.length) result.append(diagnosticList(diagnostics));
    const objectList = element(document, 'ul', {
      className: 'de-source-objects',
      'aria-label': 'Proposed diagram objects',
    });
    for (const item of [
      ...proposed.document.nodes.map((value) => ({
        ...value,
        type: 'Node',
        role: value.kind,
      })),
      ...proposed.document.relations.map((value) => ({
        ...value,
        type: 'Connector',
        role: `${value.kind} · ${value.direction}`,
      })),
      ...proposed.document.groups.map((value) => ({
        ...value,
        type: 'Container',
        role: 'container',
      })),
    ]) {
      objectList.append(
        element(
          document,
          'li',
          { 'data-object-id': item.id },
          `${item.type} · ${item.role}: ${item.label || item.id} · ${item.id}`,
        ),
      );
    }
    const proposal = element(document, 'div', {
      className: 'de-source-proposal',
    });
    const objectPane = element(document, 'div', {
      className: 'de-source-object-pane',
    });
    objectPane.append(element(document, 'h4', {}, 'Proposed objects'), objectList);
    const rendered = renderAuthoredDiagramSvg(proposed);
    if (rendered.ok) {
      proposal.append(
        element(document, 'img', {
          alt: 'Proposed diagram preview',
          className: 'de-source-image',
          src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`,
        }),
      );
    } else
      proposal.append(
        element(
          document,
          'p',
          { className: 'de-muted' },
          'A visual snapshot is unavailable for this source; inspect the proposed objects.',
        ),
      );
    proposal.append(objectPane);
    result.append(proposal);
    const canAdopt =
      state.needsInitialization &&
      state.pendingCount === 0 &&
      state.bundle !== null &&
      state.bundle.presentation.elements.length === 0 &&
      state.capabilities.read &&
      state.capabilities.write &&
      state.saveState === 'unsaved';
    if (!canAdopt)
      result.append(
        element(
          document,
          'p',
          { role: 'note' },
          'Import into a new, empty, unsaved diagram. This existing diagram stays unchanged; export it first if you need a copy.',
        ),
      );
    if (preview.requiresAcknowledgement) {
      const confirm = element(document, 'label', {
        className: 'de-source-ack',
      });
      const checkbox = element(document, 'input', {
        type: 'checkbox',
        'aria-label': 'Acknowledge this preview’s listed losses',
      });
      checkbox.addEventListener('change', () => {
        acknowledgement = checkbox.checked;
        adoptButton.disabled = !canAdopt || !acknowledgement;
      });
      confirm.append(
        checkbox,
        element(document, 'span', {}, 'I reviewed the exact conversion losses shown above.'),
      );
      result.append(confirm);
    } else adoptButton.disabled = !canAdopt;
  }
  function showExport() {
    clearError();
    const state = session.getState();
    const bundle = state.capabilities?.read ? state.bundle : null;
    exportResult.replaceChildren();
    delete exportResult.dataset.mermaidText;
    delete exportResult.dataset.bundleDigest;
    if (!bundle) {
      showError('Diagram access has changed.');
      return;
    }
    const copy = exportMermaidCopy(bundle);
    if (!copy.ok) {
      exportResult.append(diagnosticList(copy.diagnostics, { navigable: false }));
      showError(
        copy.diagnostics?.[0]?.message ??
          'Mermaid export is unavailable. Keep the editable bundle.',
      );
      return;
    }
    exportResult.append(fidelity(document, copy.fidelity));
    const snippet = element(
      document,
      'pre',
      { className: 'de-source-view', 'aria-label': 'Mermaid export source' },
      copy.text,
    );
    exportResult.append(
      snippet,
      button(document, 'Download Mermaid copy', 'source-download-mermaid'),
    );
    exportResult.dataset.mermaidText = copy.text;
    exportResult.dataset.bundleDigest = bundle.bundleDigest;
  }
  const click = (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !wrap.contains(target)) return;
    const action = target.dataset.action;
    if (action === 'source-import-tab' || action === 'source-export-tab') {
      selectTab(action === 'source-import-tab' ? 'import' : 'export');
    } else if (action === 'source-preview') showPreview();
    else if (action === 'source-adopt') {
      if (!preview?.ok || adoptButton.disabled) return;
      if (onBeforeAdopt() === false) {
        adoptButton.disabled = true;
        acknowledgement = false;
        showError('Resolve the pending editor change, then preview this copy again.');
        return;
      }
      const adopted = adoptMermaidCopy(preview, acknowledgement ? preview.acknowledgement : null);
      if (!adopted.ok) {
        adoptButton.disabled = true;
        preview = null;
        showError(adopted.diagnostics?.[0]?.message ?? 'Preview acknowledgement failed.');
        return;
      }
      const applied = session.adoptInitialCopy(adopted.bundle);
      if (!applied.ok) {
        adoptButton.disabled = true;
        preview = null;
        acknowledgement = false;
        status.textContent =
          'Adoption stopped. Preview again after resolving the reported problem.';
        showError(applied.diagnostics?.[0]?.detail ?? 'The diagram could not adopt this copy.');
        return;
      }
      status.textContent = 'Mermaid copy adopted as an unsaved diagram. Save to keep it.';
      onAdopt(applied.bundle);
    } else if (action === 'source-close') onClose?.();
    else if (action === 'source-diagnostic') {
      const item = preview?.diagnostics?.[Number(target.dataset.index)];
      if (!item) return;
      const displayedSource = textarea.value;
      const range = item.range
        ? {
            start: sourceOffset(rawSource, displayedSource, item.range.startByte),
            end: sourceOffset(rawSource, displayedSource, item.range.endByte),
          }
        : sourceLineRange(displayedSource, item.line);
      textarea.focus();
      textarea.setSelectionRange(range.start, Math.max(range.start, range.end));
      for (const row of result.querySelectorAll('[data-object-id]'))
        row.dataset.affected = String((item.elementIds ?? []).includes(row.dataset.objectId));
      if (item.elementIds?.length) onNavigateElements([...item.elementIds]);
    } else if (action === 'source-export-preview') showExport();
    else if (action === 'source-download-mermaid') {
      const state = session.getState();
      if (!state.capabilities?.read || !state.bundle) {
        showError('Diagram access has changed.');
        return;
      }
      if (state.bundle.bundleDigest !== exportResult.dataset.bundleDigest) {
        target.disabled = true;
        showError('The diagram changed. Preview the Mermaid export again before downloading it.');
        return;
      }
      download(
        document,
        exportResult.dataset.mermaidText ?? '',
        'text/plain;charset=utf-8',
        `${safeName(state.bundle.diagramId)}.mmd`,
      );
    } else if (action === 'source-export-bundle') {
      const state = session.getState();
      const bundle = state.capabilities?.read ? state.bundle : null;
      if (!bundle) {
        showError('Diagram access has changed.');
        return;
      }
      download(
        document,
        JSON.stringify(bundle, null, 2),
        'application/json',
        `${safeName(bundle.diagramId)}.planr-diagram-bundle.json`,
      );
    } else if (action === 'source-export-svg') {
      const state = session.getState();
      const bundle = state.capabilities?.read ? state.bundle : null;
      if (!bundle) {
        showError('Diagram access has changed.');
        return;
      }
      const rendered = renderAuthoredDiagramSvg(bundle);
      if (!rendered.ok) {
        const explanation =
          'Visual export needs a valid layout: ' +
          (rendered.diagnostics?.[0]?.detail ?? 'review the diagram geometry') +
          ' Keep the editable bundle.';
        showError(explanation);
        return;
      }
      download(document, rendered.svg, 'image/svg+xml', `${safeName(bundle.diagramId)}.svg`);
    }
  };
  wrap.addEventListener('click', click);
  return {
    focus: () => textarea.focus(),
    selectTab,
    dispose() {
      disposed = true;
      uploadGeneration++;
      clearError();
      wrap.removeEventListener('click', click);
      wrap.remove();
      if (standalone) root.classList.remove('planr-diagram-source-panel');
    },
    getSource: () => rawSource,
  };
}
