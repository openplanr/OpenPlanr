export const ARTIFACT_ANNOTATION_EVENTS = Object.freeze({
  draft: 'planr:artifact-annotation-draft',
  focus: 'planr:artifact-annotation-focus',
});

export const ARTIFACT_ANNOTATION_LIMITS = Object.freeze({
  dragThreshold: 4,
  maxCommentLength: 65_536,
  maxIdentityLength: 256,
});

const INTENTS = Object.freeze(['fix', 'improve', 'question']);

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value)));
}

function normalized(value) {
  return Math.round(clamp(value) * 1_000_000) / 1_000_000;
}

function assertRect(rect) {
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
    || rect.width <= 0 || rect.height <= 0) {
    throw new RangeError('Artifact bounds must have positive finite dimensions.');
  }
}

/**
 * Convert a click or reverse-direction pointer drag into bounded normalized
 * geometry. A click intentionally serializes with zero width and height.
 */
export function clientSelectionToNormalized(
  rect,
  start,
  end = start,
  { dragThreshold = ARTIFACT_ANNOTATION_LIMITS.dragThreshold } = {},
) {
  assertRect(rect);
  const startX = clamp(finite(start?.x ?? start?.clientX, rect.left), rect.left, rect.left + rect.width);
  const startY = clamp(finite(start?.y ?? start?.clientY, rect.top), rect.top, rect.top + rect.height);
  const endX = clamp(finite(end?.x ?? end?.clientX, startX), rect.left, rect.left + rect.width);
  const endY = clamp(finite(end?.y ?? end?.clientY, startY), rect.top, rect.top + rect.height);
  const dragged = Math.hypot(endX - startX, endY - startY) >= Math.max(0, finite(dragThreshold, 4));
  const left = dragged ? Math.min(startX, endX) : startX;
  const top = dragged ? Math.min(startY, endY) : startY;
  const right = dragged ? Math.max(startX, endX) : startX;
  const bottom = dragged ? Math.max(startY, endY) : startY;
  return Object.freeze({
    x: normalized((left - rect.left) / rect.width),
    y: normalized((top - rect.top) / rect.height),
    w: normalized((right - left) / rect.width),
    h: normalized((bottom - top) / rect.height),
  });
}

/** The bridge samples a point inside the frozen artifact viewport. */
export function artifactAnchorPoint(region, viewport) {
  const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
  const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
  return Object.freeze({
    x: Math.round(clamp(region?.x + finite(region?.w) / 2) * width),
    y: Math.round(clamp(region?.y + finite(region?.h) / 2) * height),
  });
}

export function annotationStyle(region) {
  return Object.freeze({
    left: `${normalized(region?.x) * 100}%`,
    top: `${normalized(region?.y) * 100}%`,
    width: `${normalized(region?.w) * 100}%`,
    height: `${normalized(region?.h) * 100}%`,
  });
}

/** Convert a viewport-normalized region into coordinates relative to a stable anchor. */
export function viewportRegionToAnchorRegion(region, viewport, anchorRect) {
  const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
  const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
  const anchorWidth = Math.max(1, finite(anchorRect?.width, 1));
  const anchorHeight = Math.max(1, finite(anchorRect?.height, 1));
  const left = clamp(region?.x) * width;
  const top = clamp(region?.y) * height;
  const right = left + clamp(region?.w) * width;
  const bottom = top + clamp(region?.h) * height;
  const x = clamp((left - finite(anchorRect?.x)) / anchorWidth);
  const y = clamp((top - finite(anchorRect?.y)) / anchorHeight);
  return Object.freeze({
    x: normalized(x),
    y: normalized(y),
    w: normalized(Math.max(0, Math.min(1 - x, (right - left) / anchorWidth))),
    h: normalized(Math.max(0, Math.min(1 - y, (bottom - top) / anchorHeight))),
  });
}

/** Project an anchor-relative persisted region back into the frozen artifact viewport. */
export function anchorRegionToViewportRegion(region, viewport, anchorRect) {
  const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
  const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
  const anchorWidth = Math.max(0, finite(anchorRect?.width));
  const anchorHeight = Math.max(0, finite(anchorRect?.height));
  return Object.freeze({
    x: normalized((finite(anchorRect?.x) + clamp(region?.x) * anchorWidth) / width),
    y: normalized((finite(anchorRect?.y) + clamp(region?.y) * anchorHeight) / height),
    w: normalized(clamp(region?.w) * anchorWidth / width),
    h: normalized(clamp(region?.h) * anchorHeight / height),
  });
}

function domToken(value) {
  const source = String(value);
  let token = '';
  for (let index = 0; index < source.length; index += 1) {
    token += source.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return token;
}

export function annotationDomIds(pinId) {
  const suffix = domToken(pinId);
  return Object.freeze({
    pin: `planr-pin-${suffix}`,
    thread: `planr-thread-${suffix}`,
  });
}

function text(value, max = ARTIFACT_ANNOTATION_LIMITS.maxCommentLength) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function make(document, tag, { className, textContent, attributes = {} } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) node.setAttribute(name, String(value));
  }
  return node;
}

function setRegionStyle(node, region) {
  const style = annotationStyle(region);
  node.style.left = style.left;
  node.style.top = style.top;
  if (region.w > 0 || region.h > 0) {
    node.style.width = style.width;
    node.style.height = style.height;
  }
}

function announce(document, value) {
  const node = document.querySelector('[data-planr-slot="review-announcer"]');
  if (node) node.textContent = value;
}

function identityName(reviewController) {
  return text(reviewController?.getIdentity?.()?.name, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
}

function createIntentPicker(document) {
  const group = make(document, 'div', {
    className: 'planr-intent-picker',
    attributes: { role: 'radiogroup', 'aria-label': 'Feedback intent' },
  });
  for (const [index, intent] of INTENTS.entries()) {
    const button = make(document, 'button', {
      textContent: intent[0].toUpperCase() + intent.slice(1),
      attributes: {
        type: 'button',
        role: 'radio',
        'aria-checked': String(index === 0),
        tabindex: index === 0 ? 0 : -1,
        'data-planr-intent': intent,
      },
    });
    group.append(button);
  }
  return group;
}

/**
 * Mount the transient annotation UI. Persistence/export belongs to the engine;
 * this controller only dispatches schema-shaped mutations to reviewController.
 */
export function mountArtifactAnnotations({
  document = globalThis.document,
  window = document?.defaultView,
  root = document?.querySelector?.('.planr-shell'),
  stageController,
  reviewController,
} = {}) {
  if (!document || !window || !root || !stageController || !reviewController) return null;
  const cleanup = [];
  let draft = null;
  let draftToken = 0;

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  function review() {
    return reviewController.getReview?.() ?? reviewController.getState?.()?.review ?? reviewController.getState?.();
  }

  function layerFor(artifactId) {
    return [...document.querySelectorAll('[data-planr-annotation-layer]')]
      .find((node) => node.dataset.planrAnnotationLayer === artifactId) ?? null;
  }

  function frameFor(artifactId) {
    return [...document.querySelectorAll('[data-planr-artifact-frame]')]
      .find((node) => node.dataset.planrArtifactFrame === artifactId) ?? null;
  }

  function focusThread(pinId) {
    const pin = review()?.pins?.find((item) => item.id === pinId);
    if (!pin) return;
    reviewController.selectPin?.(pinId);
    const state = stageController.getState();
    if (state.activeArtifactId !== pin.artifactId) {
      stageController.dispatch({ type: 'set-active', artifactId: pin.artifactId });
    }
    stageController.dispatch({ type: 'set-rail-open', railOpen: true });
    queueMicrotask(() => document.getElementById(annotationDomIds(pinId).thread)?.focus());
  }

  function focusPin(pinId) {
    const pin = review()?.pins?.find((item) => item.id === pinId);
    if (!pin) return;
    reviewController.selectPin?.(pinId);
    const state = stageController.getState();
    if (state.activeArtifactId !== pin.artifactId) {
      stageController.dispatch({ type: 'set-active', artifactId: pin.artifactId });
    }
    queueMicrotask(() => {
      const marker = document.getElementById(annotationDomIds(pinId).pin);
      marker?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
      marker?.focus?.({ preventScroll: true });
      marker?.classList.add('planr-pin-highlight');
      window.setTimeout(() => marker?.classList.remove('planr-pin-highlight'), 1_200);
    });
  }

  function renderPins() {
    const pins = Array.isArray(review()?.pins) ? review().pins : [];
    for (const layer of document.querySelectorAll('[data-planr-annotation-layer]')) {
      for (const existing of layer.querySelectorAll('[data-planr-pin-id]')) existing.remove();
      for (const existing of layer.querySelectorAll('[data-planr-pin-region-id]')) existing.remove();
      const artifactPins = pins.filter((pin) => pin.artifactId === layer.dataset.planrAnnotationLayer);
      for (const pin of artifactPins) {
        const ids = annotationDomIds(pin.id);
        const ordinal = pins.indexOf(pin) + 1;
        const hasRegion = pin.region.w > 0 || pin.region.h > 0;
        if (hasRegion) {
          const region = make(document, 'span', {
            className: `planr-pin-region planr-pin-region-${pin.intent} planr-pin-region-${pin.status}`,
            attributes: {
              'data-planr-pin-region-id': pin.id,
              'aria-hidden': 'true',
            },
          });
          setRegionStyle(region, pin.region);
          layer.append(region);
        }
        const button = make(document, 'button', {
          className: `planr-pin planr-pin-${pin.intent} planr-pin-${pin.status}${hasRegion ? ' planr-pin-region-handle' : ''}`,
          textContent: String(ordinal),
          attributes: {
            type: 'button',
            id: ids.pin,
            'data-planr-pin-id': pin.id,
            'data-planr-intent': pin.intent,
            'data-planr-status': pin.status,
            'aria-controls': ids.thread,
            'aria-label': `${pin.intent} feedback ${ordinal}: ${pin.comment}`,
          },
        });
        setRegionStyle(button, {
          x: pin.region.x + pin.region.w / 2,
          y: pin.region.y + pin.region.h / 2,
          w: 0,
          h: 0,
        });
        button.addEventListener('click', () => focusThread(pin.id));
        layer.append(button);
        if (pin.anchor?.planrId) {
          const frame = frameFor(pin.artifactId);
          Promise.resolve(frame?.__openPlanrBridge?.resolve?.(pin.anchor.planrId, pin.anchor.screen))
            .then((anchor) => {
              if (!anchor) return;
              const projected = anchorRegionToViewportRegion(pin.region, pin.viewport, anchor.rect);
              const currentButton = document.getElementById(ids.pin);
              const currentRegion = [...layer.querySelectorAll('[data-planr-pin-region-id]')]
                .find((node) => node.dataset.planrPinRegionId === pin.id);
              if (currentButton) setRegionStyle(currentButton, {
                x: projected.x + projected.w / 2,
                y: projected.y + projected.h / 2,
                w: 0,
                h: 0,
              });
              if (currentRegion) setRegionStyle(currentRegion, projected);
            })
            .catch(() => {});
        }
      }
    }
  }

  function closeComposer({ restoreFocus = false } = {}) {
    const activeLayer = draft ? layerFor(draft.artifactId) : null;
    document.querySelector('[data-planr-annotation-composer]')?.remove();
    draft = null;
    draftToken += 1;
    if (restoreFocus) activeLayer?.focus();
  }

  async function resolveAnchor(token, candidate) {
    const frame = frameFor(candidate.artifactId);
    const point = artifactAnchorPoint(candidate.region, candidate.viewport);
    let result = null;
    try {
      const anchor = frame?.__openPlanrBridge?.hitTest?.(point.x, point.y);
      if (anchor) {
        result = await Promise.race([
          anchor,
          new Promise((resolve) => window.setTimeout(() => resolve(null), 800)),
        ]);
      }
    } catch {
      result = null;
    }
    if (token !== draftToken || !draft || draft.artifactId !== candidate.artifactId) return;
    if (result?.planrId) {
      draft.anchor = Object.freeze({
        planrId: String(result.planrId).slice(0, 512),
        ...(result.screen ? { screen: String(result.screen).slice(0, 128) } : {}),
      });
      draft.region = viewportRegionToAnchorRegion(draft.region, draft.viewport, result.rect);
    }
  }

  function openComposer(detail) {
    closeComposer();
    const layer = layerFor(detail.artifactId);
    if (!layer) return;
    draftToken += 1;
    const token = draftToken;
    draft = {
      artifactId: detail.artifactId,
      region: Object.freeze({ ...detail.region }),
      viewport: Object.freeze({ ...detail.viewport }),
      variant: typeof detail.variant === 'string' && detail.variant.length > 0
        ? detail.variant
        : detail.artifactId,
      anchor: null,
    };

    const composer = make(document, 'form', {
      className: 'planr-annotation-composer',
      attributes: {
        'data-planr-annotation-composer': '',
        'aria-label': 'Add artifact feedback',
      },
    });
    const heading = make(document, 'strong', { textContent: 'New feedback' });
    const identityLabel = make(document, 'label', { textContent: 'Your name' });
    const identity = make(document, 'input', {
      attributes: {
        type: 'text',
        maxlength: ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength,
        autocomplete: 'name',
        value: identityName(reviewController),
        'data-planr-composer-identity': '',
        'aria-describedby': 'planr-composer-error',
      },
    });
    identityLabel.append(identity);
    const intentPicker = createIntentPicker(document);
    const commentLabel = make(document, 'label', { textContent: 'Feedback' });
    const comment = make(document, 'textarea', {
      attributes: {
        maxlength: ARTIFACT_ANNOTATION_LIMITS.maxCommentLength,
        required: '',
        placeholder: 'Describe what the coding agent should change or consider…',
        'data-planr-composer-comment': '',
        'aria-describedby': 'planr-composer-error',
      },
    });
    commentLabel.append(comment);
    const error = make(document, 'p', {
      className: 'planr-field-error',
      attributes: { id: 'planr-composer-error', role: 'alert', 'data-planr-composer-error': '' },
    });
    const actions = make(document, 'div', { className: 'planr-composer-actions' });
    actions.append(
      make(document, 'button', {
        textContent: 'Cancel',
        attributes: { type: 'button', 'data-planr-composer-cancel': '' },
      }),
      make(document, 'button', {
        textContent: 'Add feedback',
        attributes: { type: 'submit', 'data-planr-composer-submit': '' },
      }),
    );
    composer.append(heading, identityLabel, intentPicker, commentLabel, error, actions);
    setRegionStyle(composer, detail.region);
    layer.append(composer);

    let selectedIntent = 'fix';
    listen(intentPicker, 'click', (event) => {
      const button = event.target.closest?.('[data-planr-intent]');
      if (!button || !INTENTS.includes(button.dataset.planrIntent)) return;
      selectedIntent = button.dataset.planrIntent;
      for (const option of intentPicker.querySelectorAll('[data-planr-intent]')) {
        option.setAttribute('aria-checked', String(option === button));
        option.tabIndex = option === button ? 0 : -1;
      }
    });
    listen(intentPicker, 'keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const options = [...intentPicker.querySelectorAll('[data-planr-intent]')];
      const current = options.findIndex((option) => option.getAttribute('aria-checked') === 'true');
      const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (Math.max(0, current) + delta + options.length) % options.length;
      event.preventDefault();
      options[nextIndex].click();
      options[nextIndex].focus();
    });
    listen(composer.querySelector('[data-planr-composer-cancel]'), 'click', () => {
      closeComposer({ restoreFocus: true });
    }, { once: true });
    listen(composer, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeComposer({ restoreFocus: true });
      } else if (event.key === 'Enter' && !event.isComposing && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
    listen(composer, 'submit', (event) => {
      event.preventDefault();
      if (!draft) return;
      const author = text(identity.value, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
      const body = text(comment.value);
      identity.setAttribute('aria-invalid', String(!author));
      comment.setAttribute('aria-invalid', String(!body));
      if (!author || !body) {
        error.textContent = !author ? 'Enter your name before adding feedback.' : 'Enter feedback before submitting.';
        (!author ? identity : comment).focus();
        return;
      }
      reviewController.setIdentity?.({ name: author });
      const existingIds = new Set(review()?.pins?.map(({ id }) => id) ?? []);
      const action = {
        type: 'add-pin',
        pin: {
          artifactId: draft.artifactId,
          region: draft.region,
          viewport: draft.viewport,
          variant: draft.variant,
          ...(draft.anchor ? { anchor: draft.anchor } : {}),
          intent: selectedIntent,
          comment: body,
        },
      };
      const next = reviewController.dispatch(action);
      const nextReview = next?.review ?? next;
      const created = nextReview?.pins?.find?.(({ id }) => !existingIds.has(id));
      closeComposer();
      renderPins();
      announce(document, `${selectedIntent} feedback added.`);
      if (created?.id) queueMicrotask(() => focusThread(created.id));
    });
    comment.focus();
    root.dispatchEvent(new window.CustomEvent(ARTIFACT_ANNOTATION_EVENTS.draft, {
      bubbles: true,
      detail: Object.freeze({ ...draft }),
    }));
    void resolveAnchor(token, draft);
  }

  listen(root, 'planr:artifact-region', (event) => openComposer(event.detail));
  listen(root, 'planr:stage-change', () => {
    if (!draft) return;
    const state = stageController.getState();
    if (state.reviewMode !== 'comment') {
      closeComposer();
      return;
    }
    const visible = state.viewMode === 'split'
      ? [state.activeArtifactId, state.comparisonArtifactId]
      : [state.activeArtifactId];
    if (!visible.includes(draft.artifactId)) closeComposer();
    else draftToken += 1;
  });
  listen(root, 'planr:artifact-review-change', renderPins);
  const anchorRefresh = window.setInterval(() => {
    if (review()?.pins?.some((pin) => pin.anchor?.planrId)) renderPins();
  }, 250);
  cleanup.push(() => window.clearInterval(anchorRefresh));
  listen(root, ARTIFACT_ANNOTATION_EVENTS.focus, (event) => {
    if (event.detail?.target === 'pin') focusPin(event.detail.pinId);
    if (event.detail?.target === 'thread') focusThread(event.detail.pinId);
  });
  listen(root, 'planr:artifact-review-select', (event) => {
    if (event.detail?.source === 'thread' && typeof event.detail?.pinId === 'string') {
      focusPin(event.detail.pinId);
    }
  });

  renderPins();
  const controller = Object.freeze({
    render: renderPins,
    openComposer,
    closeComposer,
    focusPin,
    focusThread,
    destroy() {
      closeComposer();
      for (const remove of cleanup.splice(0)) remove();
      for (const pin of document.querySelectorAll('[data-planr-pin-id]')) pin.remove();
      for (const region of document.querySelectorAll('[data-planr-pin-region-id]')) region.remove();
    },
  });
  window.__openPlanrArtifactAnnotations = controller;
  return controller;
}
