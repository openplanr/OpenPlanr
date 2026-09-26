// @ts-check
import { compileDiagramCommand } from '../diagram/authoring/index.mjs';
import { mountDiagramConflicts } from './diagram-conflicts.mjs';
import { connector, freshId, laneArrangementCommand } from './diagram-editor-actions.mjs';
import { bundleOf, errText, safeAction } from './diagram-editor-commands.mjs';
import { button, element, field } from './diagram-editor-dom.mjs';
import { mountDiagramSourcePanel } from './diagram-source-panel.mjs';

const EMPTY_CALLBACK = () => {};

/**
 * The modal dialog layer: one dialog at a time, background inert while open, focus restored on close.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorDialogs}
 */
export function createEditorDialogs(ctx) {
  const { doc, win, session, dom } = ctx;
  const { shell, stage, dialogLayer } = dom;
  const current = ctx.current,
    report = ctx.report;
  let dialog = null,
    dialogOpener = null,
    sourceMount = null,
    sourceDraft = null,
    conflictMount = null;

  function closeDialog({ restoreFocus = true } = {}) {
    if (!dialog) return;
    const target = restoreFocus
      ? dialogOpener?.isConnected && shell.contains(dialogOpener)
        ? dialogOpener
        : stage
      : null;
    if (sourceMount) report('');
    sourceMount?.dispose();
    sourceMount = null;
    dialog.remove();
    dialog = null;
    dialogOpener = null;
    dialogLayer.replaceChildren();
    ctx.chrome.setBackgroundInert(false);
    const restore = () => {
      if (ctx.isDisposed() || dialog || !target) return;
      const destination = target?.isConnected && shell.contains(target) ? target : stage;
      destination.focus({ preventScroll: true });
    };
    if (target) {
      restore();
      win.queueMicrotask(restore);
    }
  }
  function openDialog(name, content) {
    closeDialog({ restoreFocus: false });
    const trigger = ctx.commands.trigger();
    const active = trigger?.isConnected ? trigger : doc.activeElement;
    ctx.chrome.setOverflow(false, { restoreFocus: false });
    dialogOpener = active?.closest?.('.de-more-menu') ? dom.moreButton : active;
    const panel = element(doc, 'section', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': name,
      className: 'de-dialog',
    });
    panel.append(element(doc, 'h2', {}, name));
    if (content) panel.append(content);
    dialogLayer.append(panel);
    dialog = panel;
    ctx.chrome.setBackgroundInert(true);
    panel.querySelector('button,input,select')?.focus();
    return panel;
  }
  function cancelDialog(state) {
    if (state.gesture) session.cancelGesture('cancel-dialog');
    closeDialog();
  }
  /** @param {{ tab?: 'import' | 'export' }} [options] */
  function openSourcePanel({ tab: initialTab = 'import' } = {}) {
    const state = current();
    if (!state.bundle || !ctx.inspector.guardDraft()) return false;
    report('');
    const slot = element(doc, 'div', { className: 'de-source-slot' });
    openDialog('Mermaid import and export', slot).classList.add('de-source-dialog');
    sourceMount = mountDiagramSourcePanel({
      root: slot,
      session,
      source: sourceDraft ?? state.bundle.originalSource?.text ?? '',
      initialTab,
      onSourceChange: (value) => {
        sourceDraft = value;
      },
      onBeforeAdopt: ctx.inspector.guardDraft,
      onNavigateElements: (ids) => {
        const available = new Set(
          current().bundle?.presentation.elements.map((item) => item.elementId) ?? [],
        );
        const selected = ids.filter((id) => available.has(id));
        if (selected.length) ctx.commands.select(selected, { force: true });
      },
      onAdopt: (bundle) => {
        sourceDraft = bundle.originalSource?.text ?? sourceDraft;
        closeDialog();
        report('');
        ctx.notice('Mermaid copy adopted as an unsaved diagram. Save to keep it.');
        ctx.canvas.fit();
      },
      onClose: () => {
        report('');
        closeDialog();
      },
      onReport: EMPTY_CALLBACK,
    });
    if (initialTab === 'import') sourceMount.focus();
    else sourceMount.selectTab('export', { focus: true });
    return true;
  }
  function askDelete() {
    const state = current(),
      ids = state.view.selection;
    if (!ids.length || !state.bundle) return;
    const preview = compileDiagramCommand(
      state.bundle,
      { type: 'delete', ids },
      { transactionId: freshId() },
    );
    const impact = preview.ok ? null : preview.deletionImpact;
    if (!impact) {
      report(errText(preview));
      return;
    }
    const body = element(doc, 'div');
    body.append(
      element(
        doc,
        'p',
        {},
        'Delete ' +
          impact.elementIds.length +
          ' object(s), including ' +
          impact.relationIds.length +
          ' connector(s)? This can be undone before another conflicting change.',
      ),
    );
    if (impact.relationIds.length)
      body.append(
        element(
          doc,
          'p',
          { className: 'de-muted' },
          'Connectors: ' + impact.relationIds.join(', '),
        ),
      );
    body.append(
      button(doc, 'Cancel', 'cancel-dialog'),
      button(doc, 'Delete', 'confirm-delete', { className: 'de-danger' }),
    );
    openDialog('Delete selection', body).dataset.impact = JSON.stringify(impact);
  }
  function confirmDelete(ids) {
    const impact = JSON.parse(dialog.dataset.impact);
    const result = ctx.commands.submit({ type: 'delete', ids, confirmedImpact: impact });
    if (result.ok) {
      ctx.commands.select([], { force: true });
      closeDialog();
    }
  }
  function connectDialog() {
    const state = current(),
      nodes = bundleOf(state).document.nodes;
    if (nodes.length < 2) {
      report('Create at least two nodes to connect.');
      return;
    }
    const body = element(doc, 'div'),
      ids = state.view.selection;
    const from = field(
      doc,
      'From',
      ids.find((id) => nodes.some((node) => node.id === id)) ?? nodes[0].id,
      { choices: nodes.map((node) => [node.id, node.label]) },
    );
    const to = field(
      doc,
      'To',
      ids.find((id) => nodes.some((node) => node.id === id && node.id !== from.input.value)) ??
        nodes[nodes.length - 1].id,
      { choices: nodes.map((node) => [node.id, node.label]) },
    );
    const label = field(doc, 'Connector label', '');
    body.append(
      from.label,
      to.label,
      label.label,
      button(doc, 'Cancel', 'cancel-dialog'),
      button(doc, 'Create connector', 'confirm-connect', { className: 'de-primary' }),
    );
    openDialog('Connect objects', body);
  }
  function confirmConnect() {
    const from = dialog.querySelector('[aria-label="From"]').value,
      to = dialog.querySelector('[aria-label="To"]').value,
      label = dialog.querySelector('[aria-label="Connector label"]').value;
    const command = connector(from, to, label);
    const result = ctx.commands.submit(command, [command.elements[0].value.id]);
    if (result.ok) closeDialog();
  }
  /** @param {'horizontal' | 'vertical' | null} [lane] */
  function layoutDialog(lane = null) {
    const body = element(doc, 'div');
    body.append(
      element(
        doc,
        'p',
        {},
        'Preview the arrangement before applying. No changes are saved during preview.',
      ),
    );
    if (!lane) {
      const scope = field(doc, 'Arrange', 'selection', {
        choices: [
          ['selection', 'Selection'],
          ['all', 'Whole diagram'],
        ],
      });
      body.append(scope.label);
    }
    if (lane)
      body.append(
        element(
          doc,
          'p',
          {},
          'Arrange direct members within this lane. Container geometry changes only when you apply.',
        ),
      );
    body.append(
      button(doc, 'Cancel layout', 'cancel-layout'),
      button(doc, 'Preview layout', 'preview-layout', { className: 'de-primary' }),
    );
    const panel = openDialog('Layout preview', body);
    if (lane) panel.dataset.lane = lane;
  }
  function previewLayout(state, bundle, ids) {
    if (state.gesture) session.cancelGesture('new-layout');
    const start = session.beginGesture();
    if (!start.ok) {
      report(errText(start));
      return;
    }
    let preview;
    if (dialog.dataset.lane) {
      const laneId = ids[0],
        direction = dialog.dataset.lane;
      preview = safeAction(
        () => session.previewGesture(laneArrangementCommand(bundle, laneId, direction)),
        report,
      );
    } else {
      const scope = dialog.querySelector('[aria-label="Arrange"]').value;
      const targets = (
        scope === 'all' ? bundle.presentation.elements.map((item) => item.elementId) : ids
      ).filter((id) => !bundle.document.relations.some((relation) => relation.id === id));
      preview = session.previewLayout({ targetIds: targets.slice(0, 256) });
    }
    if (!preview?.ok) {
      if (preview) report(errText(preview));
      session.cancelGesture('invalid-layout');
      return;
    }
    dialog
      .querySelector('[data-action="preview-layout"]')
      .replaceWith(button(doc, 'Apply layout', 'apply-layout', { className: 'de-primary' }));
    dialog.append(
      element(
        doc,
        'p',
        { className: 'de-muted' },
        'Preview only · No changes saved. Apply as one undoable edit.',
      ),
    );
  }
  function applyLayout() {
    const result = session.completeGesture();
    if (!result.ok) report(errText(result));
    else {
      closeDialog();
      ctx.notice('Layout applied as one edit. Save to keep it.');
    }
  }
  function cancelLayout() {
    session.cancelGesture('cancel-layout');
    closeDialog();
  }
  function showJson(title, value) {
    const pre = element(
      doc,
      'pre',
      { className: 'de-source-view' },
      JSON.stringify(value, null, 2),
    );
    const body = element(doc, 'div');
    body.append(pre, button(doc, 'Close', 'cancel-dialog'));
    openDialog(title, body);
  }
  function compareRevisions() {
    const wrap = element(doc, 'div');
    openDialog('Compare revisions', wrap);
    conflictMount?.dispose();
    conflictMount = mountDiagramConflicts({
      root: wrap,
      session,
      onClose: closeDialog,
      onError: (result) => report(errText(result)),
    });
  }
  return {
    active: () => dialog,
    close: closeDialog,
    cancel: cancelDialog,
    openSourcePanel,
    openDelete: askDelete,
    confirmDelete,
    openConnect: connectDialog,
    confirmConnect,
    openLayout: layoutDialog,
    previewLayout,
    applyLayout,
    cancelLayout,
    showJson,
    compareRevisions,
    dispose() {
      conflictMount?.dispose();
      sourceMount?.dispose();
    },
  };
}
