import type {
  DiagramReviewTarget,
  DiagramReviewBundle as LegacyDiagramReviewBundle,
} from '@openplanr/protocol/diagram-review-contracts';
import {
  assertVersionedDiagramReviewBundle,
  type DiagramReviewBundleV11,
} from '@openplanr/protocol/studio-presentation-contracts';
import { createDiagramEditorSession } from '../diagram/editor/session.mjs';
import { escapeHtml } from '../internal/escape.mjs';
import { ARTIFACT_ANNOTATION_CSS, ARTIFACT_ANNOTATION_MOBILE_CSS } from './annotation-styles.mjs';
import { type ArtifactAnnotationDraftSnapshot, mountArtifactAnnotations } from './annotations.mjs';
import { mountDiagramEditor } from './diagram-editor.mjs';
import { ensureDiagramReviewFont } from './diagram-review-font.mjs';
import { renderDiagramReviewShell } from './diagram-shell.mjs';
import {
  type DiagramCommentSubmission,
  mountDiagramStudio,
  type StudioConfig,
} from './diagram-studio.mjs';
import { prepareDiagramSvg } from './diagram-svg.mjs';
import {
  type ArtifactReviewInput,
  createArtifactReviewController,
  normalizeArtifactReview,
} from './feedback-rail.mjs';
import { renderArtifactRail } from './renderers.mjs';

type DiagramReviewBundle = LegacyDiagramReviewBundle | DiagramReviewBundleV11;
function assertDiagramReviewBundle(value: unknown): DiagramReviewBundle {
  assertVersionedDiagramReviewBundle(value);
  return value as DiagramReviewBundle;
}

export { diagramReviewSvgExport, ensureDiagramReviewFont } from './diagram-review-font.mjs';

export interface DiagramSharedReviewHost {
  reviewOf: string;
  initialReview?: ArtifactReviewInput | null;
  /** Disable new feedback on an earlier or paused revision. Source editing is always disabled. */
  readOnly?: boolean;
  saveReview?: (review: unknown) => Promise<void>;
  onComment?: (target: DiagramReviewTarget) => void;
  onSubmitComment?: (value: DiagramCommentSubmission) => Promise<void>;
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
  onExportAll?: (format: 'feedback-json' | 'feedback-md') => void;
  toolbarControls?: HTMLElement;
  onReady?: () => void;
}
export interface DiagramSharedReviewController {
  ready: Promise<void>;
  dispose(): void;
  select(id: string): void;
  fit(): void;
  updateReview(review: ArtifactReviewInput | null): void;
  setReadOnly(value: boolean): void;
  snapshotDraft(): ArtifactAnnotationDraftSnapshot | null;
  restoreDraft(value: ArtifactAnnotationDraftSnapshot | null): void;
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
function legacyMarkup(bundle: DiagramReviewBundle, allFeedback = false) {
  const scene = bundle.scene;
  const links = displayItems(scene)
    .map(
      (item, index) =>
        `<button type="button" data-item-index="${index}"><span>${escapeHtml(item.kind)}</span>${escapeHtml(item.label)}</button>`,
    )
    .join('');
  return renderDiagramReviewShell({
    title: bundle.title,
    diagramId: bundle.diagramId,
    summary: bundle.summary ?? '',
    grammar: bundle.grammar ?? 'Diagram',
    scene,
    svg: scene.svg,
    navigator: links,
    rail: renderArtifactRail({ railOpen: false, feedbackCount: 0 } as Parameters<
      typeof renderArtifactRail
    >[0]),
    revisions: true,
    saveLabel: 'Shared review',
    exportsHtml:
      '<strong>Drawing</strong><button type="button" data-export="svg">SVG</button><button type="button" data-export="png">PNG</button><strong>Current revision</strong><button type="button" data-export="feedback-json">Feedback JSON</button><button type="button" data-export="feedback-md">Feedback Markdown</button>' +
      (allFeedback
        ? '<strong>All revisions</strong><button type="button" data-export="all-feedback-json">Feedback JSON · All revisions</button><button type="button" data-export="all-feedback-md">Feedback Markdown · All revisions</button>'
        : ''),
  });
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
  let snapshotDraft: () => ArtifactAnnotationDraftSnapshot | null = () => null;
  let restoreDraft: (value: ArtifactAnnotationDraftSnapshot | null) => void = () => {};
  let openComment: (target: DiagramReviewTarget) => void = () => {};
  const comment = (target: DiagramReviewTarget) => {
    if (readOnly) return;
    host.onComment?.(target);
    openComment(target);
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
        toolbarControls: host.toolbarControls,
        exportActions: [
          {
            id: 'svg',
            label: 'SVG',
            group: 'Drawing',
            onSelect: () => host.onExport?.('svg', bundle),
          },
          { id: 'png', label: 'PNG', onSelect: () => host.onExport?.('png', bundle) },
          {
            id: 'feedback-json',
            label: 'Feedback JSON',
            group: 'Current revision',
            onSelect: () => host.onExport?.('feedback-json', bundle),
          },
          {
            id: 'feedback-md',
            label: 'Feedback Markdown',
            onSelect: () => host.onExport?.('feedback-md', bundle),
          },
          ...(host.onExportAll
            ? [
                {
                  id: 'all-feedback-json',
                  label: 'Feedback JSON · All revisions',
                  group: 'All revisions',
                  onSelect: () => host.onExportAll?.('feedback-json'),
                },
                {
                  id: 'all-feedback-md',
                  label: 'Feedback Markdown · All revisions',
                  onSelect: () => host.onExportAll?.('feedback-md'),
                },
              ]
            : []),
        ],
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
            label: 'Annotate point',
            hidden: () => readOnly,
            onSelect: () => {
              pinning = true;
              root.dataset.commentMode = 'true';
              canvas.focus();
            },
          },
          {
            id: 'comment',
            label: 'Annotate',
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
            },
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
    const composerReview = createArtifactReviewController({
      initialReview: host.initialReview,
      reviewOf: host.reviewOf,
    });
    const annotationLayer = document.createElement('div');
    annotationLayer.hidden = true;
    annotationLayer.dataset.planrAnnotationLayer = bundle.diagramId;
    root.append(annotationLayer);
    let composerTarget: DiagramReviewTarget = {};
    const composer = mountArtifactAnnotations({
      root,
      document,
      window,
      reviewController: composerReview,
      stageController: {
        getState: () => ({
          status: 'ready',
          activeArtifactId: bundle.diagramId,
          reviewMode: 'interact',
          artifacts: [
            {
              id: bundle.diagramId,
              viewport: { width: bundle.scene.width, height: bundle.scene.height },
            },
          ],
        }),
        dispatch(action) {
          if (action.type === 'set-rail-open' && action.railOpen) mounted.openPanel('review');
        },
      },
    });
    snapshotDraft = () => composer?.snapshotDraft() ?? null;
    restoreDraft = (value) => {
      composer?.restoreDraft(value);
    };
    openComment = (target) => {
      composerTarget = target;
      composer?.openComposer({
        artifactId: bundle.diagramId,
        viewport: { width: bundle.scene.width, height: bundle.scene.height },
        region: { x: target.x ?? 0.5, y: target.y ?? 0.5, w: 0, h: 0 },
        variant: 'diagram',
      });
    };
    const pendingComments = new Map<string, DiagramCommentSubmission>();
    let sendingComments = false;
    const delivery = document.createElement('button');
    delivery.type = 'button';
    delivery.className = 'de-status diagram-comment-delivery';
    delivery.hidden = true;
    delivery.setAttribute('role', 'status');
    root.append(delivery);
    async function sendComments() {
      if (sendingComments) return;
      sendingComments = true;
      delivery.disabled = true;
      delivery.hidden = false;
      delivery.textContent = 'Saving feedback…';
      for (const [id, value] of pendingComments) {
        try {
          if (host.onSubmitComment) await host.onSubmitComment(value);
          else if (host.saveReview) await host.saveReview(composerReview.getReview());
          else {
            delivery.textContent = 'Feedback retained in this preview';
            break;
          }
          pendingComments.delete(id);
        } catch {
          delivery.disabled = false;
          delivery.textContent = 'Feedback could not send · Retry';
          sendingComments = false;
          return;
        }
      }
      sendingComments = false;
      if (!pendingComments.size) delivery.textContent = 'Feedback saved';
    }
    delivery.addEventListener('click', () => {
      void sendComments();
    });
    cleanups.push(
      composerReview.subscribe((state, change) => {
        if (change.type !== 'review' || change.action !== 'add-pin') return;
        const pin = state.review?.pins.find((pin) => pin.id === state.activePinId);
        if (!pin || readOnly) return;
        pendingComments.set(pin.id, {
          operationId: pin.id,
          target: { ...composerTarget },
          comment: pin.comment,
          author: pin.author,
          intent: pin.intent,
        });
        review = state.review;
        drawPins();
        void sendComments();
      }),
    );
    cleanups.push(() => {
      composer?.destroy();
      composerReview.destroy();
      delivery.remove();
      annotationLayer.remove();
    });
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
      composerReview.replaceReview(review);
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
        composer?.closeComposer();
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
    root.innerHTML = legacyMarkup(safe, Boolean(host.onExportAll));
    if (host.toolbarControls) {
      host.toolbarControls.dataset.studioHostControls = '';
      root.querySelector('.diagram-toolbar')?.append(host.toolbarControls);
    }
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
      onSubmitComment: host.onSubmitComment,
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
    snapshotDraft = () => mounted.annotations.snapshotDraft();
    restoreDraft = (value) => {
      mounted.annotations.restoreDraft(value);
    };
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
      else if (target.dataset.export?.startsWith('all-')) {
        host.onExportAll?.(target.dataset.export.slice(4) as 'feedback-json' | 'feedback-md');
        return;
      }
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
    snapshotDraft: () => snapshotDraft(),
    restoreDraft: (value) => restoreDraft(value),
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
