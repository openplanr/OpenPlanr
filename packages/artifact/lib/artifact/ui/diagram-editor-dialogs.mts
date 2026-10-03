import type { VersionedDiagramAuthoringBundle as DiagramAuthoringBundle } from '@openplanr/protocol/studio-presentation-contracts';

import { compileDiagramCommand, type DiagramCommandResult } from '../diagram/authoring/index.mjs';
import { elementIndex } from '../diagram/authoring/model.mjs';
import type { DiagramEditorState } from '../diagram/editor/index.mjs';
import { mountDiagramConflicts } from './diagram-conflicts.mjs';
import {
  connector,
  displayName,
  freshId,
  laneArrangementCommand,
  quantity,
} from './diagram-editor-actions.mjs';
import { bundleOf, errText, safeAction } from './diagram-editor-commands.mjs';
import { button, element, type FieldControl, field } from './diagram-editor-dom.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';
import { mountDiagramSourcePanel } from './diagram-source-panel.mjs';

export interface DiagramEditorDialogs {
  active(): HTMLElement | null;
  close(options?: { restoreFocus?: boolean }): void;
  /** Close the open dialog, cancelling any gesture it previewed. */
  cancel(state: DiagramEditorState): void;
  openSourcePanel(options?: { tab?: 'import' | 'export' }): boolean;
  openDelete(): void;
  confirmDelete(ids: string[]): void;
  openConnect(): void;
  confirmConnect(): void;
  openLayout(lane?: 'horizontal' | 'vertical' | null): void;
  previewLayout(state: DiagramEditorState, bundle: DiagramAuthoringBundle, ids: string[]): void;
  applyLayout(): void;
  cancelLayout(): void;
  showJson(title: string, value: unknown): void;
  compareRevisions(): void;
  dispose(): void;
}

const EMPTY_CALLBACK = () => {};

/** The modal dialog layer: one dialog at a time, background inert while open, focus restored on close. */
export function createEditorDialogs(ctx: DiagramEditorContext): DiagramEditorDialogs {
  const { doc, win, session, dom } = ctx;
  const { shell, stage, dialogLayer } = dom;
  const current = ctx.current,
    report = ctx.report;
  let dialog: HTMLElement | null = null,
    dialogOpener: HTMLElement | SVGElement | null = null,
    sourceMount: ReturnType<typeof mountDiagramSourcePanel> | null = null,
    sourceDraft: string | null = null,
    conflictMount: ReturnType<typeof mountDiagramConflicts> | null = null;

  function closeDialog({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
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
  /** The dialog's buttons, right-aligned in one footer row. */
  function actions(...controls: HTMLElement[]) {
    const row = element(doc, 'div', { className: 'de-dialog-actions' });
    row.append(...controls);
    return row;
  }
  function openDialog(name: string, content?: HTMLElement) {
    closeDialog({ restoreFocus: false });
    const trigger = ctx.commands.trigger();
    // The focused element of an HTML document is an HTML or SVG element.
    const active = trigger?.isConnected
      ? trigger
      : (doc.activeElement as HTMLElement | SVGElement | null);
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
    panel.querySelector<HTMLElement>('button,input,select')?.focus();
    return panel;
  }
  function cancelDialog(state: DiagramEditorState) {
    if (state.gesture) session.cancelGesture('cancel-dialog');
    closeDialog();
  }
  function openSourcePanel({ tab: initialTab = 'import' }: { tab?: 'import' | 'export' } = {}) {
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
    const objects = impact.elementIds.length,
      connectors = impact.relationIds.length;
    const scope = !connectors
      ? quantity(objects, 'object')
      : connectors === objects
        ? quantity(connectors, 'connector')
        : `${quantity(objects, 'object')}, including ${quantity(connectors, 'connector')}`;
    const body = element(doc, 'div');
    body.append(
      element(
        doc,
        'p',
        {},
        `Delete ${scope}? This can be undone before another conflicting change.`,
      ),
    );
    if (connectors) {
      const index = elementIndex(state.bundle.document),
        removed = new Set(impact.relationIds);
      // Impact ids are sorted by id, which says nothing to a reader; use document order.
      const names = state.bundle.document.relations
        .filter((relation) => removed.has(relation.id))
        .map((relation) => displayName(index, relation.id));
      body.append(
        element(
          doc,
          'p',
          { className: 'de-muted' },
          `${connectors === 1 ? 'Connector' : 'Connectors'}: ${names.join(', ')}`,
        ),
      );
    }
    body.append(
      actions(
        button(doc, 'Cancel', 'cancel-dialog'),
        button(doc, 'Delete', 'confirm-delete', { className: 'de-danger' }),
      ),
    );
    openDialog('Delete selection', body).dataset.impact = JSON.stringify(impact);
  }
  function confirmDelete(ids: string[]) {
    // Confirm Delete is dispatched from the open delete dialog, which holds its impact.
    const impact = JSON.parse((dialog as HTMLElement).dataset.impact as string);
    const result = ctx.commands.submit({ type: 'delete', ids, confirmedImpact: impact });
    if (result.ok) {
      ctx.commands.select([], { force: true });
      closeDialog();
    }
  }
  function connectDialog() {
    const state = current(),
      diagram = bundleOf(state).document,
      nodes = diagram.nodes;
    if (nodes.length < 2) {
      report('Create at least two nodes to connect.');
      return;
    }
    const body = element(doc, 'div'),
      ids = state.view.selection,
      index = elementIndex(diagram);
    // biome-ignore format: bundles keep this one-line array; wrapping would change their bytes.
    const choices: Array<[string, string]> = nodes.map((node) => [node.id, displayName(index, node.id)]);
    const from = field(
      doc,
      'From',
      ids.find((id) => nodes.some((node) => node.id === id)) ?? nodes[0].id,
      { choices },
    );
    const to = field(
      doc,
      'To',
      ids.find((id) => nodes.some((node) => node.id === id && node.id !== from.input.value)) ??
        nodes[nodes.length - 1].id,
      { choices },
    );
    const label = field(doc, 'Connector label', '');
    body.append(
      from.label,
      to.label,
      label.label,
      actions(
        button(doc, 'Cancel', 'cancel-dialog'),
        button(doc, 'Create connector', 'confirm-connect', { className: 'de-primary' }),
      ),
    );
    openDialog('Connect objects', body);
  }
  function confirmConnect() {
    // Create Connector is dispatched from the open connect dialog and its three fields.
    // biome-ignore format: bundles keep this one-line declaration list; wrapping would change their bytes.
    const from = ((dialog as HTMLElement).querySelector('[aria-label="From"]') as FieldControl).value,
      to = ((dialog as HTMLElement).querySelector('[aria-label="To"]') as FieldControl).value,
      label = ((dialog as HTMLElement).querySelector('[aria-label="Connector label"]') as FieldControl).value;
    const command = connector(from, to, label);
    const result = ctx.commands.submit(command, [command.elements[0].value.id]);
    if (result.ok) closeDialog();
  }
  function layoutDialog(lane: 'horizontal' | 'vertical' | null = null) {
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
      actions(
        button(doc, 'Cancel layout', 'cancel-layout'),
        button(doc, 'Preview layout', 'preview-layout', { className: 'de-primary' }),
      ),
    );
    const panel = openDialog('Layout preview', body);
    if (lane) panel.dataset.lane = lane;
  }
  function previewLayout(state: DiagramEditorState, bundle: DiagramAuthoringBundle, ids: string[]) {
    if (state.gesture) session.cancelGesture('new-layout');
    const start = session.beginGesture();
    if (!start.ok) {
      report(errText(start));
      return;
    }
    // Preview Layout is dispatched from the open layout dialog, whose lane is a layoutDialog direction.
    let preview: DiagramCommandResult | null;
    if ((dialog as HTMLElement).dataset.lane) {
      const laneId = ids[0],
        direction = (dialog as HTMLElement).dataset.lane as 'horizontal' | 'vertical';
      preview = safeAction(
        () => session.previewGesture(laneArrangementCommand(bundle, laneId, direction)),
        report,
      );
    } else {
      const scope = (
        (dialog as HTMLElement).querySelector('[aria-label="Arrange"]') as FieldControl
      ).value;
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
    (
      (dialog as HTMLElement).querySelector('[data-action="preview-layout"]') as HTMLElement
    ).replaceWith(button(doc, 'Apply layout', 'apply-layout', { className: 'de-primary' }));
    ((dialog as HTMLElement).querySelector('.de-dialog-actions') as HTMLElement).before(
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
  function showJson(title: string, value: unknown) {
    const pre = element(
      doc,
      'pre',
      { className: 'de-source-view' },
      JSON.stringify(value, null, 2),
    );
    const body = element(doc, 'div');
    body.append(pre, actions(button(doc, 'Close', 'cancel-dialog')));
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
