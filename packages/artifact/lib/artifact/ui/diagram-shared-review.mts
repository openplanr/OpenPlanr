import {
  assertDiagramReviewBundle,
  type DiagramReviewBundle,
  type DiagramReviewTarget,
} from '@openplanr/protocol/diagram-review-contracts';
import { createDiagramEditorSession } from '../diagram/editor/session.mjs';
import { escapeHtml } from '../internal/escape.mjs';
import { ARTIFACT_ANNOTATION_CSS, ARTIFACT_ANNOTATION_MOBILE_CSS } from './annotation-styles.mjs';
import { mountDiagramEditor } from './diagram-editor.mjs';
import { ensureDiagramReviewFont } from './diagram-review-font.mjs';
import { mountDiagramStudio, type StudioConfig } from './diagram-studio.mjs';
import { prepareDiagramSvg } from './diagram-svg.mjs';
import { type ArtifactReviewInput, normalizeArtifactReview } from './feedback-rail.mjs';
import { renderArtifactRail } from './renderers.mjs';

export { diagramReviewSvgExport, ensureDiagramReviewFont } from './diagram-review-font.mjs';

export interface DiagramSharedReviewHost {
  reviewOf: string;
  initialReview?: ArtifactReviewInput | null;
  /** Disable new feedback on an earlier or paused revision. Source editing is always disabled. */
  readOnly?: boolean;
  saveReview?: (review: unknown) => Promise<void>;
  onComment?: (target: DiagramReviewTarget) => void;
  onSelect?: (id: string) => void;
  mountReview?: (options: {
    root: HTMLElement;
    bundle: DiagramReviewBundle;
    select: (id: string) => void;
    comment: (target: DiagramReviewTarget) => void;
  }) => (() => void) | void;
  mountRevisions?: (options: {
    root: HTMLElement;
    bundle: DiagramReviewBundle;
  }) => (() => void) | void;
  onExport?: (
    format: 'svg' | 'png' | 'feedback-json' | 'feedback-md',
    bundle: DiagramReviewBundle,
  ) => void;
  onReady?: () => void;
}
export interface DiagramSharedReviewController {
  ready: Promise<void>;
  dispose(): void;
  select(id: string): void;
  fit(): void;
  updateReview(review: ArtifactReviewInput | null): void;
  setReadOnly(value: boolean): void;
}
/** Scene items with each connection named by its endpoints when it has no label of its own. */
function displayItems(scene: DiagramReviewBundle['scene']) {
  const labels = new Map(scene.items.map((item) => [item.id, item.label]));
  const relations = new Map(scene.relations.map((relation) => [relation.id, relation]));
  return scene.items.map((item) => {
    const relation = relations.get(item.id);
    if (!relation) return item;
    const fromLabel = labels.get(relation.from) || relation.from;
    const toLabel = labels.get(relation.to) || relation.to;
    return {
      ...item,
      label: relation.label || `${fromLabel} → ${toLabel}`,
      from: relation.from,
      to: relation.to,
      fromLabel,
      toLabel,
    };
  });
}
function legacyMarkup(bundle: DiagramReviewBundle) {
  const scene = bundle.scene;
  const links = displayItems(scene)
    .map(
      (item, index) =>
        `<button type="button" data-item-index="${index}"><span>${escapeHtml(item.kind)}</span>${escapeHtml(item.label)}</button>`,
    )
    .join('');
  return `<div class="planr-shell diagram-shell" data-planr-review-mode="interact" data-planr-rail-open="false" data-outline-open="true">
  <header class="planr-toolbar diagram-toolbar"><button class="planr-toolbar-action" type="button" data-action="outline" aria-expanded="true" aria-controls="diagram-outline">Navigator</button><div class="planr-brand"><span class="planr-title-block"><strong>${escapeHtml(bundle.title)}</strong><span class="diagram-subtitle">${escapeHtml(bundle.grammar ?? 'Diagram')} · Read only</span></span></div><nav data-presentation-nav hidden><button data-action="previous-chapter">←</button><strong data-chapter-label>Overview</strong><span data-chapter-progress></span><button data-action="next-chapter">→</button></nav><button data-save-state disabled hidden></button><button class="planr-toolbar-action" data-action="present" aria-pressed="false">Present</button><button class="planr-toolbar-action" data-action="review" aria-expanded="false">Discussion <span data-comment-count>0</span></button><button class="planr-toolbar-action" data-shared-history>Revisions</button><details class="diagram-export"><summary>Export</summary><div class="diagram-export-menu"><button data-export="svg">SVG</button><button data-export="png">PNG</button><button data-export="feedback-json">Feedback JSON</button><button data-export="feedback-md">Feedback Markdown</button></div></details></header>
  <div class="diagram-workspace"><aside id="diagram-outline" class="diagram-outline" aria-label="Diagram navigator"><div class="diagram-overview"><p>${escapeHtml(bundle.summary ?? '')}</p></div><section class="diagram-element-details" data-element-details hidden aria-label="Selected element"><header><strong data-element-kind></strong><button type="button" data-action="close-details" aria-label="Clear selected element">×</button></header><h2 data-element-label></h2><p data-element-endpoints></p><p data-element-description></p><details><summary>Element reference</summary><code data-element-id></code></details><div><button type="button" data-action="toggle-group" aria-pressed="false" hidden>Collapse group details</button><button type="button" data-action="comment-element">Comment on element</button><button type="button" data-action="connections" aria-pressed="false">Focus connections</button></div></section><label class="diagram-search">Find in diagram<input type="search" data-search placeholder="Search labels…"></label><nav aria-label="Diagram elements">${links}<p data-search-empty hidden>No matching labels.</p></nav></aside>
  <main class="diagram-canvas" tabindex="0" aria-label="Diagram canvas"><div class="diagram-scene" style="width:${scene.width}px;height:${scene.height}px"><div class="diagram-drawing">${scene.svg}</div><div class="planr-annotation-layer" data-planr-annotation-layer="${escapeHtml(bundle.diagramId)}" aria-label="Diagram annotations"></div><div data-selection class="planr-region-selection" hidden></div></div><div class="diagram-canvas-tools" role="toolbar" aria-label="Diagram tools"><div><button type="button" data-action="pan" aria-pressed="true" title="Pan (V)">Pan</button><button type="button" data-action="comment" aria-pressed="false" title="Add comment (C)">Comment</button></div><div><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="actual" data-zoom title="Actual size (1)">100%</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button></div><div><button type="button" data-action="fit" title="Fit diagram (F)">Fit</button><button type="button" data-action="width" title="Fit width (W)">Fit width</button></div></div><div class="diagram-canvas-status" role="status" data-canvas-status>Drag anywhere to pan</div></main>
  ${renderArtifactRail({ railOpen: false, feedbackCount: 0 } as Parameters<typeof renderArtifactRail>[0])}</div><p class="planr-visually-hidden" data-planr-announcer aria-live="polite"></p></div>`;
}
/** Native scene review, with the same legacy camera or read-only authored editor as the owner. */
export function mountDiagramSharedReview({
  root,
  bundle: input,
  host,
}: {
  root: HTMLElement;
  bundle: unknown;
  host: DiagramSharedReviewHost;
}): DiagramSharedReviewController {
  const bundle = assertDiagramReviewBundle(input);
  const drawing = prepareDiagramSvg(bundle.scene.svg, {
    allowOffset: bundle.source.kind === 'authoring',
  });
  if (drawing.scene.width !== bundle.scene.width || drawing.scene.height !== bundle.scene.height)
    throw new Error('The shared scene dimensions do not match its SVG.');
  if (!/^[a-f0-9]{64}$/u.test(host.reviewOf))
    throw new Error('A shared review needs the exact published digest.');
  const document = root.ownerDocument;
  const fontReady = ensureDiagramReviewFont(document);
  const window = document.defaultView as Window & typeof globalThis;
  const cleanups: Array<() => void> = [];
  function required<E extends Element>(selector: string, scope: Element = root): E {
    const value = scope.querySelector<E>(selector);
    if (!value) throw new Error('The native diagram review could not mount its required controls.');
    return value;
  }
  let disposed = false;
  let readOnly = !!host.readOnly;
  let setReadOnly = (value: boolean) => {
    readOnly = value;
  };
  root.classList.add('diagram-shared-review');
  root.dataset.diagramSharedReady = 'false';
  root.dataset.colorScheme = bundle.colorScheme ?? 'light';
  root.dataset.planrTheme = bundle.colorScheme ?? 'light';
  const annotationStyles = document.createElement('style');
  annotationStyles.dataset.planrAnnotationStyles = '';
  annotationStyles.textContent = ARTIFACT_ANNOTATION_CSS + ARTIFACT_ANNOTATION_MOBILE_CSS;
  const safe = { ...bundle, scene: { ...bundle.scene, svg: drawing.svg } };
  const history = document.createElement('aside');
  history.className = 'diagram-shared-history';
  history.hidden = true;
  history.setAttribute('aria-label', 'Published revisions');
  const title = document.createElement('h2');
  title.textContent = 'Revisions';
  history.append(title);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close revisions';
  history.append(close);
  const revisions = document.createElement('div');
  history.append(revisions);
  const toggleHistory = () => {
    history.hidden = !history.hidden;
    if (!history.hidden) close.focus();
  };
  close.addEventListener('click', toggleHistory);
  let select: (id: string) => void = () => {};
  let fit: () => void = () => {};
  let updateReview: (review: ArtifactReviewInput | null) => void = () => {};
  const comment = (target: DiagramReviewTarget) => {
    if (!readOnly) host.onComment?.(target);
  };
  if (bundle.authored) {
    root.replaceChildren();
    const session = createDiagramEditorSession({
      bundle: bundle.authored,
      acknowledged: true,
      capabilities: { read: true, write: false },
    });
    let pinning = false;
    let canvas: HTMLElement;
    const mounted = mountDiagramEditor({
      root,
      session,
      host: {
        labels: {
          subtitle: 'Encrypted shared diagram',
          readOnly: host.readOnly
            ? 'Earlier revision · Read only'
            : 'Published revision · Read only',
        },
        colorScheme: bundle.colorScheme ?? 'light',
        mountReview: host.mountReview
          ? ({ root: panel }) =>
              host.mountReview?.({ root: panel, bundle, select: (id) => select(id), comment }) ??
              null
          : undefined,
        actions: [
          {
            id: 'present',
            label: 'Present',
            onSelect: () => {
              void root.requestFullscreen?.();
            },
          },
          {
            id: 'pin-comment',
            label: 'Pin comment',
            hidden: () => readOnly,
            onSelect: () => {
              pinning = true;
              root.dataset.commentMode = 'true';
              canvas.focus();
            },
          },
          {
            id: 'comment',
            label: 'Comment',
            hidden: () => readOnly,
            onSelect: () => {
              const id = session.getState().view.selection[0];
              const item = bundle.scene.items.find((item) => item.id === id);
              comment(
                item
                  ? {
                      elementId: id,
                      x: Math.max(0, Math.min(1, item.x / bundle.scene.width)),
                      y: Math.max(0, Math.min(1, item.y / bundle.scene.height)),
                    }
                  : {},
              );
              mounted.openPanel('review');
            },
          },
          { id: 'export-svg', label: 'SVG', onSelect: () => host.onExport?.('svg', bundle) },
          { id: 'export-png', label: 'PNG', onSelect: () => host.onExport?.('png', bundle) },
          {
            id: 'export-feedback-json',
            label: 'Feedback JSON',
            onSelect: () => host.onExport?.('feedback-json', bundle),
          },
          {
            id: 'export-feedback-md',
            label: 'Feedback Markdown',
            onSelect: () => host.onExport?.('feedback-md', bundle),
          },
        ],
        panels: [
          {
            id: 'revisions',
            label: 'Revisions',
            mount: ({ root: panel }) => host.mountRevisions?.({ root: panel, bundle }) ?? null,
          },
        ],
      },
    });
    select = (id) => {
      session.setView({ selection: [id] });
      host.onSelect?.(id);
    };
    fit = () => {
      root.querySelector<HTMLButtonElement>('[data-action="fit"]')?.click();
    };
    root.prepend(annotationStyles);
    canvas = required<HTMLElement>('.de-canvas');
    const world = required<SVGGElement>('[data-world]');
    const bounds = drawing.svg.match(/viewBox="([^"]+)"/u);
    if (!bounds) throw new Error('The authored diagram needs its saved scene bounds.');
    const origin = bounds[1].split(/\s+/u).map(Number);
    let review = host.initialReview ? normalizeArtifactReview(host.initialReview) : null;
    const pins = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pins.setAttribute('data-review-pins', '');
    function drawPins() {
      pins.replaceChildren();
      if (review?.reviewOf !== host.reviewOf) return;
      for (const pin of review.pins) {
        if (pin.artifactId !== bundle.diagramId) continue;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', String(origin[0] + pin.region.x * bundle.scene.width));
        circle.setAttribute('cy', String(origin[1] + pin.region.y * bundle.scene.height));
        circle.setAttribute('r', String(7 / session.getState().view.camera.scale));
        circle.setAttribute('fill', pin.status === 'resolved' ? '#166534' : '#0f766e');
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', String(2 / session.getState().view.camera.scale));
        circle.setAttribute('data-review-pin', pin.id);
        circle.setAttribute('role', 'button');
        circle.setAttribute('tabindex', '0');
        circle.setAttribute('aria-label', pin.comment);
        circle.style.pointerEvents = 'all';
        const open = () => {
          if (pin.anchor) select(pin.anchor.planrId);
          mounted.openPanel('review');
        };
        circle.addEventListener('click', open);
        circle.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
        pins.append(circle);
      }
      world.append(pins);
    }
    updateReview = (value) => {
      review = value ? normalizeArtifactReview(value) : null;
      drawPins();
    };
    const pick = (event: PointerEvent) => {
      if (!pinning || readOnly || !(event.target as Element).closest('[data-editor-svg]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const matrix = world.getScreenCTM();
      if (!matrix) return;
      const point = new window.DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      const x = (point.x - origin[0]) / bundle.scene.width,
        y = (point.y - origin[1]) / bundle.scene.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      const elementId =
        (event.target as Element).closest('[data-element-id]')?.getAttribute('data-element-id') ??
        undefined;
      pinning = false;
      root.dataset.commentMode = 'false';
      comment({ ...(elementId ? { elementId } : {}), x, y });
      mounted.openPanel('review');
    };
    const cancelPin = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        pinning = false;
        root.dataset.commentMode = 'false';
      }
    };
    canvas.addEventListener('pointerdown', pick, true);
    root.addEventListener('keydown', cancelPin, true);
    cleanups.push(() => {
      canvas.removeEventListener('pointerdown', pick, true);
      root.removeEventListener('keydown', cancelPin, true);
    });
    cleanups.push(session.subscribe(drawPins));
    drawPins();
    setReadOnly = (value) => {
      readOnly = value;
      if (value) {
        pinning = false;
        root.dataset.commentMode = 'false';
      }
      for (const button of root.querySelectorAll<HTMLButtonElement>(
        '[data-host-action="pin-comment"],[data-host-action="comment"]',
      ))
        button.disabled = value;
    };
    let selected = '';
    cleanups.push(
      session.subscribe(() => {
        const id = session.getState().view.selection[0] ?? '';
        if (id && id !== selected) host.onSelect?.(id);
        selected = id;
      }),
    );
    cleanups.push(() => {
      mounted.dispose();
      session.dispose();
    });
  } else {
    root.innerHTML = legacyMarkup(safe);
    root.prepend(annotationStyles);
    const shell = required<HTMLElement>('.diagram-shell');
    const config: StudioConfig = {
      artifact: {
        id: bundle.diagramId,
        title: bundle.title,
        viewport: { width: bundle.scene.width, height: bundle.scene.height },
      },
      items: displayItems(bundle.scene),
      relations: bundle.scene.relations,
      review: host.initialReview ?? null,
      reviewOf: host.reviewOf,
      base: '',
      diagramId: bundle.diagramId,
    };
    const studioHost = {
      saveReview: host.saveReview,
      onComment: host.onComment ? comment : undefined,
      onSelect: host.onSelect,
      readOnly,
      sceneCoordinates: true,
      savedLabel: 'Comments saved to shared review',
    };
    const mounted = mountDiagramStudio(document, { root: shell, config, host: studioHost });
    setReadOnly = (value) => {
      readOnly = value;
      studioHost.readOnly = value;
      for (const button of shell.querySelectorAll<HTMLButtonElement>(
        '[data-action=comment],[data-action=comment-element]',
      ))
        button.disabled = value;
    };
    select = (id) => mounted.select(id);
    fit = () => mounted.fit();
    updateReview = (review) => mounted.updateReview(review);
    if (host.mountReview) {
      for (const selector of [
        '.planr-identity',
        '[data-planr-slot="feedback-rail"]',
        '.planr-decision-slot',
      ])
        required<HTMLElement>(selector, shell).hidden = true;
      const slot = required<HTMLElement>('[data-planr-slot="domain-rail"]', shell);
      slot.hidden = false;
      const dispose = host.mountReview({ root: slot, bundle, select, comment });
      if (dispose) cleanups.push(dispose);
    }
    if (host.readOnly)
      for (const button of shell.querySelectorAll<HTMLButtonElement>(
        '[data-action="comment"],[data-action="comment-element"]',
      ))
        button.disabled = true;
    const onClick = (event: Event) => {
      const target = (event.target as Element).closest<HTMLElement>(
        '[data-export],[data-shared-history]',
      );
      if (!target) return;
      if (target.hasAttribute('data-shared-history')) toggleHistory();
      else
        host.onExport?.(
          target.dataset.export as Parameters<NonNullable<DiagramSharedReviewHost['onExport']>>[0],
          bundle,
        );
    };
    shell.addEventListener('click', onClick);
    cleanups.push(() => shell.removeEventListener('click', onClick));
    root.append(history);
    const dispose = host.mountRevisions?.({ root: revisions, bundle });
    if (dispose) cleanups.push(dispose);
    cleanups.push(() => mounted.destroy());
  }
  const ready = fontReady
    .then(() => {
      if (disposed) return;
      fit();
      root.dataset.diagramSharedReady = 'true';
      host.onReady?.();
    })
    .catch((error) => {
      root.dataset.diagramSharedReady = 'failed';
      throw error;
    });
  return {
    ready,
    select,
    fit,
    updateReview,
    setReadOnly,
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanups
        .splice(0)
        .reverse()
        .forEach((dispose) => {
          dispose();
        });
      root.replaceChildren();
      root.dataset.diagramSharedReady = 'false';
    },
  };
}
