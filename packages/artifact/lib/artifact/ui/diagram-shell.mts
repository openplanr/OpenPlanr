import { escapeHtml } from '../internal/escape.mjs';
import { renderPlanrMark } from './renderers.mjs';
export interface DiagramReviewShellOptions {
  title: string;
  diagramId: string;
  summary: string;
  grammar: string;
  scene: { width: number; height: number };
  svg: string;
  navigator: string;
  rail: string;
  exportsHtml: string;
  counts?: { items: number; connections: number };
  feedbackCount?: number;
  canShare?: boolean;
  revisions?: boolean;
  saveLabel?: string;
}
/** Trusted review skeleton for both local and published scenes; capabilities supply actions. */
export function renderDiagramReviewShell({
  title,
  diagramId,
  summary,
  grammar,
  scene,
  svg,
  navigator,
  rail,
  exportsHtml,
  counts = { items: 0, connections: 0 },
  feedbackCount = 0,
  canShare = false,
  revisions = false,
  saveLabel = 'Read only',
}: DiagramReviewShellOptions) {
  return `<div class="planr-shell diagram-shell" data-planr-diagram-studio="2" data-planr-review-mode="interact" data-planr-rail-open="false" data-outline-open="true">
<header class="planr-toolbar diagram-toolbar"><button class="planr-toolbar-action diagram-outline-toggle" type="button" data-action="outline" aria-expanded="true" aria-controls="diagram-outline" aria-label="Toggle navigator" title="Navigator (N)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button><div class="planr-brand" aria-label="OpenPlanr Diagram Studio">${renderPlanrMark()}<span class="planr-title-block"><strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong><span class="diagram-subtitle"><span class="diagram-subtitle-grammar">${escapeHtml(grammar)}</span> · ${counts.items} items · ${counts.connections} connections</span></span></div><nav class="diagram-presentation-nav" data-presentation-nav aria-label="Presentation chapters" hidden><button type="button" data-action="previous-chapter" aria-label="Previous chapter">←</button><div><strong data-chapter-label>Overview</strong><span data-chapter-progress>1 of 1</span></div><button type="button" data-action="next-chapter" aria-label="Next chapter">→</button></nav><span class="planr-toolbar-spacer" aria-hidden="true"></span><button class="diagram-save" type="button" role="status" data-save-state disabled title="Comments are stored on this computer, next to the rendered diagram">${escapeHtml(saveLabel)}</button><div class="diagram-header-actions">${canShare ? '<button class="planr-toolbar-action" type="button" data-action="share-diagram">Share diagram</button>' : ''}<button class="planr-toolbar-action" type="button" data-action="present" aria-pressed="false" title="Present (P)">Present</button><button class="planr-toolbar-action" type="button" data-action="review" aria-expanded="false" aria-controls="planr-review-rail">Review <span class="planr-count" data-comment-count>${feedbackCount}</span></button>${revisions ? '<button class="planr-toolbar-action" type="button" data-shared-history>Revisions</button>' : ''}<details class="diagram-export"><summary class="planr-toolbar-action planr-share">Export</summary><div class="diagram-export-menu">${exportsHtml}</div></details></div></header>
<div class="diagram-workspace"><aside id="diagram-outline" class="diagram-outline" aria-label="Diagram navigator"><div class="diagram-overview"><span class="diagram-type">${escapeHtml(grammar)}</span><p>${escapeHtml(summary)}</p></div><section class="diagram-element-details" data-element-details hidden aria-label="Selected element"><header><strong data-element-kind></strong><button type="button" data-action="close-details" aria-label="Clear selected element">×</button></header><h2 data-element-label></h2><p data-element-endpoints></p><p data-element-description></p><details><summary>Element reference</summary><code data-element-id></code></details><div><button type="button" data-action="toggle-group" aria-pressed="false" hidden>Collapse group details</button><button type="button" data-action="comment-element">Annotate element</button><button type="button" data-action="connections" aria-pressed="false">Focus connections</button></div></section><label class="diagram-search">Find in diagram<input type="search" placeholder="Search labels…" data-search></label><nav aria-label="Diagram elements">${navigator}<p data-search-empty hidden>No matching labels.</p></nav><footer><details class="diagram-legend"><summary>How to read this diagram</summary><p>${grammar === 'sequence' ? 'Boxes are participants. Dashed vertical lines are lifelines; messages follow time from top to bottom. Sections mark journey stages.' : 'Boxes are items. Solid arrows are flows; dashed arrows are dependencies. Select an item to inspect its direct connections.'}</p><p>Highlighted items are selected; dimmed items are outside the focused connections. Collapsed groups keep the layout and hide their detail. Focus never changes exported content.</p></details><span>Drag to pan · Click an element for details · Pinch or ⌘/Ctrl + scroll to zoom</span></footer></aside>
<main class="diagram-canvas" aria-label="Diagram canvas" tabindex="0"><div class="diagram-scene" style="width:${scene.width}px;height:${scene.height}px"><div class="diagram-drawing">${svg}</div><div class="planr-annotation-layer" data-planr-annotation-layer="${escapeHtml(diagramId)}" aria-label="Diagram annotations"></div><div class="planr-region-selection" data-selection hidden></div></div><div class="diagram-canvas-tools" role="toolbar" aria-label="Diagram tools"><div><button type="button" data-action="pan" aria-pressed="true" title="Pan (V)">Interact</button><button type="button" data-action="comment" aria-pressed="false" title="Add comment (C)">Annotate</button><button type="button" data-action="inspect" aria-pressed="false" title="Inspect elements (I)">Inspect</button></div><div><button type="button" data-action="zoom-out" aria-label="Zoom out">−</button><button type="button" data-action="actual" data-zoom title="Actual size (1)">100%</button><button type="button" data-action="zoom-in" aria-label="Zoom in">+</button></div><div><button type="button" data-action="fit" title="Fit diagram (F)">Fit</button><button type="button" data-action="width" title="Fit width (W)">Fit width</button></div></div><div class="diagram-canvas-status" role="status" data-canvas-status>Drag anywhere to pan</div></main>
${rail}</div><p class="planr-visually-hidden" aria-live="polite" data-planr-announcer></p></div>`;
}
