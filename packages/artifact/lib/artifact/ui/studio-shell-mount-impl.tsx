import { normalizeDiagramPresentation } from '@openplanr/protocol/studio-presentation-contracts';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { readEditorState } from '../diagram/editor/session-view.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';
import {
  StudioButton,
  StudioMenu,
  type StudioMenuItem,
  StudioPanelDialog,
  StudioToolbar,
} from './studio-shell.mjs';

export interface DesignChromeState {
  view: string;
  navOpen: boolean;
  reviewOpen: boolean;
  previewLabel: string;
  saveLabel: string;
  savePhase: string;
  exportMenuOpen?: boolean;
}
export interface StudioChromeController {
  update(value: Partial<DesignChromeState>): void;
  destroy(): void;
}
/** Only the trusted header is replaced. Stage, frames, rails, annotations and drafts retain identity. */
export function mountDesignStudioChrome({
  root,
  title,
  state: initial,
}: {
  root: HTMLElement;
  title: string;
  state: Pick<DesignChromeState, 'view' | 'navOpen' | 'reviewOpen'>;
}): StudioChromeController | null {
  const document = root.ownerDocument;
  const window = document.defaultView;
  if (!window) return null;
  const old = root.querySelector<HTMLElement>('.design-toolbar');
  if (!old || old.hasAttribute('data-studio-react-chrome')) return null;
  const share = old.querySelector<HTMLElement>('.design-share');
  const showShare = !!share && !share.hidden;
  const showExport = !old.querySelector<HTMLElement>('.design-export')?.hidden;
  let state: DesignChromeState = {
    previewLabel:
      old.querySelector('[data-design-preview-state]')?.textContent ?? 'Loading preview',
    saveLabel: old.querySelector('[data-design-save-state]')?.textContent ?? 'Loading studio',
    savePhase: 'loading',
    ...initial,
    exportMenuOpen: false,
  };
  const listeners = new Set<() => void>();
  const update = (value: Partial<DesignChromeState>) => {
    const next = { ...state, ...value };
    if (
      Object.keys(next).every(
        (key) => next[key as keyof DesignChromeState] === state[key as keyof DesignChromeState],
      )
    )
      return;
    state = next;
    flushSync(() =>
      listeners.forEach((listener) => {
        listener();
      }),
    );
  };
  const mount = document.createElement('div');
  mount.className = 'studio-chrome-mount';
  old.replaceWith(mount);
  const react = createRoot(mount);
  function Chrome() {
    const current = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => state,
    );
    return (
      <StudioToolbar
        title={title}
        kind="design"
        className="design-toolbar"
        leading={
          <StudioButton
            className="planr-toolbar-action design-panel-toggle"
            variant="ghost"
            data-design-toggle-nav=""
            aria-controls="design-navigator"
            aria-expanded={current.navOpen}
            aria-label="Screens"
            title="Screens"
          >
            ☰<span className="design-button-label">Screens</span>
          </StudioButton>
        }
        viewPicker={
          <fieldset className="planr-segment design-view-picker" aria-label="Design view">
            {['canvas', 'prototype', 'walkthrough'].map((view) => (
              <StudioButton
                variant="ghost"
                key={view}
                data-design-view={view}
                aria-pressed={current.view === view}
                aria-label={view[0].toUpperCase() + view.slice(1)}
                title={view[0].toUpperCase() + view.slice(1)}
              >
                <span aria-hidden="true">
                  {view === 'canvas' ? '▦' : view === 'prototype' ? '▷' : '▤'}
                </span>
                <span className="design-button-label">{view[0].toUpperCase() + view.slice(1)}</span>
              </StudioButton>
            ))}
          </fieldset>
        }
        status={
          <>
            <output className="design-preview-state" data-design-preview-state="">
              {current.previewLabel}
            </output>
            <output
              className="design-save-state"
              aria-live="polite"
              data-design-save-state=""
              data-status={current.savePhase}
            >
              {current.saveLabel}
            </output>
          </>
        }
        actions={
          <>
            <StudioButton
              className="planr-toolbar-action design-review-toggle"
              data-planr-action="feedback"
              data-planr-review-label="Review"
              aria-controls="planr-review-rail"
              aria-expanded={current.reviewOpen}
              aria-label="Review"
              title="Review"
            >
              ☷<span className="design-button-label">Review</span>
            </StudioButton>
            {showShare && <PreservedNode element={share} />}
            {showExport && (
              <StudioMenu
                className="design-export"
                label="Export"
                open={current.exportMenuOpen}
                onOpenChange={(open) => update({ exportMenuOpen: open })}
                triggerAttributes={{ 'data-studio-export-menu': '' }}
                items={[
                  {
                    id: 'html',
                    label: 'Portable HTML',
                    group: 'design',
                    attributes: { 'data-design-export': 'html' },
                  },
                  {
                    id: 'png',
                    label: 'Screen PNG',
                    group: 'design',
                    attributes: { 'data-design-export': 'png' },
                  },
                ]}
              />
            )}
          </>
        }
      />
    );
  }
  flushSync(() => react.render(<Chrome />));
  // Hosted save adapters can update status through their existing DOM seam. Capture that
  // label into the typed store before any later React chrome update, without owning their saves.
  const observer = new window.MutationObserver(() => {
    const node = root.querySelector<HTMLElement>('[data-design-save-state]');
    if (node)
      update({
        saveLabel: node.textContent ?? '',
        savePhase: node.dataset.status ?? state.savePhase,
      });
  });
  observer.observe(mount, {
    subtree: true,
    characterData: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-status'],
  });
  root.dataset.studioFramework = 'react';
  let destroyed = false;
  return {
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      flushSync(() => react.unmount());
      mount.replaceWith(old);
      delete root.dataset.studioFramework;
    },
  };
}

function PersistentPanel({ element }: { element: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = host.current;
    if (!target) return;
    const marker = element.ownerDocument.createComment('studio-panel-home');
    element.before(marker);
    target.append(element);
    return () => {
      marker.replaceWith(element);
    };
  }, [element]);
  return <div ref={host} className="studio-panel-content" />;
}
/** Move existing rail DOM into a controlled mobile dialog; never clone or remount its forms. */
export function mountStudioPanelDialogs({
  root,
  closePanel,
  breakpoint = 960,
}: {
  root: HTMLElement;
  closePanel: (side: 'left' | 'right') => void;
  breakpoint?: number;
}) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  if (!window) return { destroy() {} };
  const left = root.querySelector<HTMLElement>('.design-navigator,.diagram-outline');
  const right = root.querySelector<HTMLElement>('.planr-review-rail');
  if (!left || !right) return { destroy() {} };
  const panels = { left, right };
  const mount = document.createElement('div');
  mount.className = 'studio-panel-mount';
  root.append(mount);
  const react = createRoot(mount);
  let snapshot = '';
  let wasCompact = false;
  let lastOpenSide = 'left';
  const listeners = new Set<() => void>();
  const read = () => {
    const width = root.getBoundingClientRect().width || window.innerWidth;
    const compact = width <= breakpoint;
    if (compact && !wasCompact) {
      wasCompact = true;
      if (root.dataset.outlineOpen === 'true') closePanel('left');
    }
    wasCompact = compact;
    const next =
      width <= breakpoint
        ? root.dataset.designNavOpen === 'true' || root.dataset.outlineOpen === 'true'
          ? 'left'
          : root.dataset.planrRailOpen === 'true'
            ? 'right'
            : ''
        : '';
    if (snapshot !== next) {
      if (next) lastOpenSide = next;
      snapshot = next;
      listeners.forEach((listener) => {
        listener();
      });
    }
  };
  function Panels() {
    const side = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => snapshot,
    );
    return (
      <StudioPanelDialog
        open={!!side}
        side={side === 'left' ? 'left' : 'right'}
        title={side === 'left' ? 'Screens' : 'Review'}
        container={root}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          root
            .querySelector<HTMLElement>(
              lastOpenSide === 'left'
                ? '[data-design-toggle-nav],[data-action=outline]'
                : '[data-planr-action=feedback],[data-action=review]',
            )
            ?.focus({ preventScroll: true });
        }}
        onOpenChange={(open) => {
          if (!open && side) closePanel(side as 'left' | 'right');
        }}
      >
        {side && (
          <PersistentPanel key={side} element={panels[side === 'left' ? 'left' : 'right']} />
        )}
      </StudioPanelDialog>
    );
  }
  read();
  flushSync(() => react.render(<Panels />));
  const observer = new window.MutationObserver(read);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-design-nav-open', 'data-outline-open', 'data-planr-rail-open'],
  });
  const resize =
    typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(read) : null;
  resize?.observe(root);
  window.addEventListener('resize', read);
  return {
    destroy() {
      observer.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', read);
      flushSync(() => react.unmount());
      mount.remove();
    },
  };
}

function PreservedNode({ element }: { element: HTMLElement | null }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const marker = element.ownerDocument.createComment('studio-control-home');
    element.before(marker);
    host.current?.append(element);
    return () => {
      marker.replaceWith(element);
    };
  }, [element]);
  return <span ref={host} className="studio-preserved-control" />;
}
/** Local and hosted diagram reviews use this same trusted toolbar. */
export function mountDiagramStudioChrome({ root, title }: { root: HTMLElement; title: string }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  if (!window) return { destroy() {} };
  const old = root.querySelector<HTMLElement>('.diagram-toolbar');
  if (!old || old.hasAttribute('data-studio-react-chrome')) return { destroy() {} };
  const presentation = old.querySelector<HTMLElement>('[data-presentation-nav]');
  const save = old.querySelector<HTMLElement>('[data-save-state]');
  const count = old.querySelector<HTMLElement>('[data-comment-count]');
  const share = old.querySelector<HTMLElement>('[data-action="share-diagram"]');
  const revisions = old.querySelector<HTMLElement>('[data-shared-history]');
  const hostControls = old.querySelector<HTMLElement>('[data-studio-host-controls]');
  const exportItems: StudioMenuItem[] = [
    ...old.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>(
      '.diagram-export-menu a,.diagram-export-menu button',
    ),
  ].map((item, index) => ({
    id: `export-${index}`,
    label: item.textContent ?? 'Export',
    group:
      item.previousElementSibling?.tagName === 'STRONG'
        ? (item.previousElementSibling.textContent ?? undefined)
        : undefined,
    attributes: item.dataset.export ? { 'data-export': item.dataset.export } : undefined,
    onSelect:
      item instanceof window.HTMLAnchorElement
        ? () => {
            const download = document.createElement('a');
            download.href = item.href;
            download.download = item.download;
            download.click();
          }
        : undefined,
  }));
  let snapshot = `${root.dataset.outlineOpen}|${root.dataset.planrRailOpen}|${root.dataset.present}`;
  const listeners = new Set<() => void>();
  const mount = document.createElement('div');
  mount.className = 'studio-chrome-mount';
  old.replaceWith(mount);
  const react = createRoot(mount);
  function Chrome() {
    const [outline, review, present] = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => snapshot,
    ).split('|');
    return (
      <StudioToolbar
        title={title}
        kind="diagram"
        className="diagram-toolbar"
        leading={
          <StudioButton
            variant="ghost"
            className="planr-toolbar-action diagram-outline-toggle"
            data-action="outline"
            aria-expanded={outline === 'true'}
            aria-controls="diagram-outline"
            aria-label="Navigator"
            title="Navigator"
          >
            ☰
          </StudioButton>
        }
        viewPicker={<PreservedNode element={presentation} />}
        status={<PreservedNode element={save} />}
        actions={
          <>
            {share && (
              <StudioButton
                className="planr-toolbar-action"
                variant="primary"
                data-action="share-diagram"
              >
                Share<span className="design-button-label"> diagram</span>
              </StudioButton>
            )}
            <StudioButton
              className="planr-toolbar-action"
              data-action="present"
              aria-pressed={present === 'true'}
              aria-label={present === 'true' ? 'Exit presentation' : 'Present'}
              title={present === 'true' ? 'Exit presentation (Escape)' : 'Present (P)'}
            >
              {present === 'true' ? '×' : '▷'}
              <span className="design-button-label">
                {present === 'true' ? 'Exit presentation' : 'Present'}
              </span>
            </StudioButton>
            <StudioButton
              className="planr-toolbar-action"
              data-action="review"
              aria-expanded={review === 'true'}
              aria-controls="planr-review-rail"
              aria-label="Review"
              title="Review"
            >
              ☷<span className="design-button-label">Review</span>
              <PreservedNode element={count} />
            </StudioButton>
            {revisions && (
              <StudioButton
                className="planr-toolbar-action"
                data-shared-history=""
                aria-label="Revisions"
                title="Revisions"
              >
                ◷<span className="design-button-label">Revisions</span>
              </StudioButton>
            )}
            <StudioMenu
              label="Export"
              className="diagram-export"
              triggerAttributes={{ 'data-studio-export-menu': '' }}
              items={exportItems}
            />
            <PreservedNode element={hostControls} />
          </>
        }
      />
    );
  }
  flushSync(() => react.render(<Chrome />));
  root.dataset.studioFramework = 'react';
  const observer = new window.MutationObserver(() => {
    const next = `${root.dataset.outlineOpen}|${root.dataset.planrRailOpen}|${root.dataset.present}`;
    if (next !== snapshot) {
      snapshot = next;
      flushSync(() =>
        listeners.forEach((listener) => {
          listener();
        }),
      );
    }
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-outline-open', 'data-planr-rail-open', 'data-present'],
  });
  return {
    destroy() {
      observer.disconnect();
      flushSync(() => react.unmount());
      mount.replaceWith(old);
      if (presentation) old.append(presentation);
      if (save) old.append(save);
      if (count) old.append(count);
      delete root.dataset.studioFramework;
    },
  };
}

/** React owns authoring chrome while the existing editor keeps its stable command and canvas seams. */
export function mountDiagramEditorChrome(ctx: DiagramEditorContext) {
  const { dom, doc, session } = ctx;
  const old = [...dom.bar.childNodes];
  const mount = doc.createElement('div');
  mount.className = 'studio-chrome-mount';
  dom.bar.replaceChildren(mount);
  let state = readEditorState(session);
  const listeners = new Set<() => void>();
  const choose = (theme: 'light' | 'dark') => {
    if (!ctx.editable(ctx.current())) return;
    if (!ctx.inspector.guardDraft()) return;
    {
      const result = session.submit({
        type: 'set-studio-presentation',
        presentation: normalizeDiagramPresentation({ theme }),
      });
      if (!result.ok) ctx.report(result.diagnostics.map((item) => item.detail).join(' '));
      else if ('bundle' in result) {
        ctx.notice(
          `${theme === 'dark' ? 'Dark' : 'Light'} palette selected. Save to create a presentation revision.`,
        );
      }
    }
  };
  function Chrome() {
    const current = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => state,
    );
    return (
      <StudioToolbar
        as="div"
        title={current.bundle?.document.title ?? 'Diagram unavailable'}
        titleNode={<PreservedNode element={dom.title} />}
        subtitle={<PreservedNode element={dom.subtitle} />}
        kind="diagram"
        brand={ctx.host.brand !== false}
        leading={<PreservedNode element={dom.barStart} />}
        status={<PreservedNode element={dom.saveState} />}
        actions={
          <>
            <PreservedNode element={dom.barCenter} />
            {!ctx.readOnly(current) && (
              <StudioMenu
                label="Palette"
                triggerAttributes={{ 'data-studio-palette-menu': '' }}
                items={(['light', 'dark'] as const).map((theme) => ({
                  id: theme,
                  label: `${theme === 'light' ? 'Light' : 'Dark'}${current.bundle?.schemaVersion === '1.1.0' && current.bundle.studioPresentation.theme === theme ? ' · Selected' : ''}`,
                  disabled: !ctx.editable(current),
                  onSelect: () => choose(theme),
                  attributes: { 'data-studio-palette': theme },
                }))}
              />
            )}
            <PreservedNode element={dom.barEnd} />
            <PreservedNode element={dom.moreWrap} />
            {ctx.host.exportActions && <StudioMenu label="Export" items={ctx.host.exportActions} />}
            <PreservedNode element={ctx.host.toolbarControls ?? null} />
          </>
        }
      />
    );
  }
  let release: () => void;
  if (ctx.host.mountChrome) {
    let hostRelease: (() => void) | undefined;
    flushSync(() => {
      hostRelease = ctx.host.mountChrome?.({ container: mount, content: <Chrome /> });
    });
    if (typeof hostRelease !== 'function') {
      dom.bar.replaceChildren(...old);
      throw new TypeError('Host mountChrome must return a release function.');
    }
    release = hostRelease;
  } else {
    const react = createRoot(mount);
    flushSync(() => react.render(<Chrome />));
    release = () => flushSync(() => react.unmount());
  }
  let destroyed = false;
  dom.shell.dataset.studioFramework = 'react';
  return {
    update() {
      if (destroyed) return;
      state = readEditorState(session);
      flushSync(() =>
        listeners.forEach((listener) => {
          listener();
        }),
      );
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      release();
      dom.bar.replaceChildren(...old);
      delete dom.shell.dataset.studioFramework;
    },
  };
}
