import { clientSelectionToNormalized, mountArtifactAnnotations } from './annotations.mjs';
import { mountArtifactFeedbackRail } from './feedback-rail.mjs';

/** One camera owns all diagram coordinates. No scroll-sized wrappers or frames. */
export function mountDiagramStudio(document = globalThis.document) {
  const window = document.defaultView;
  const root = document.querySelector('.diagram-shell');
  const config = JSON.parse(document.getElementById('diagram-studio-data').textContent);
  const canvas = root.querySelector('.diagram-canvas');
  const surface = root.querySelector('.diagram-scene');
  const drawing = root.querySelector('.diagram-drawing');
  const { width, height } = config.artifact.viewport;
  const camera = { x: 0, y: 0, scale: 1, fit: 'all' };
  const state = {
    status: 'ready',
    activeArtifactId: config.artifact.id,
    artifacts: [config.artifact],
    reviewMode: 'interact',
  };
  const cleanup = [];
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    cleanup.push(() => target.removeEventListener(event, handler, options));
  };
  let paintId = 0,
    space = false,
    gesture = null,
    annotations;
  let selectedIndex = -1,
    connectionFocus = false,
    presentationIndex = 0;
  const intentLabels = { fix: 'Change request', improve: 'Suggestion', question: 'Question' };
  const semanticAttributes = [
    'data-item-id',
    'data-relation-id',
    'data-phase-id',
    'data-group-id',
    'data-lane-id',
    'data-annotation-id',
    'data-scene-id',
  ];
  const drawingElements = [
    ...drawing.querySelectorAll(semanticAttributes.map((attribute) => `[${attribute}]`).join(',')),
  ];
  const elementIndex = new Map(
    drawingElements.map((element) => [
      semanticAttributes.map((attribute) => element.getAttribute(attribute)).find(Boolean),
      element,
    ]),
  );
  const itemIndex = new Map(config.items.map((item, index) => [item.id, index]));
  const groups = new Map(
    config.items.filter((item) => item.kind === 'Group').map((item) => [item.id, item]),
  );
  const groupMembers = new Map();
  const collapsedGroups = new Set();
  let groupHiddenIds = new Set();
  function resolveGroupMembers(id, trail = new Set()) {
    if (groupMembers.has(id)) return groupMembers.get(id);
    if (trail.has(id)) return new Set();
    const members = new Set();
    trail.add(id);
    for (const member of groups.get(id)?.members ?? []) {
      members.add(member);
      if (groups.has(member))
        for (const nested of resolveGroupMembers(member, trail)) members.add(nested);
    }
    trail.delete(id);
    groupMembers.set(id, members);
    return members;
  }
  for (const id of groups.keys()) resolveGroupMembers(id);
  function elementBounds(id) {
    const element = elementIndex.get(id);
    if (!element) return null;
    const bounds = element.getBBox();
    return {
      x: Math.max(0, bounds.x - 4),
      y: Math.max(0, bounds.y - 4),
      width: Math.max(8, bounds.width + 8),
      height: Math.max(8, bounds.height + 8),
    };
  }
  function hitItem(x, y) {
    return (
      config.items
        .map((item, index) => ({ item, index, rect: elementBounds(item.id) }))
        .filter(
          ({ item, rect }) =>
            !groupHiddenIds.has(item.id) &&
            rect &&
            x >= rect.x &&
            x <= rect.x + rect.width &&
            y >= rect.y &&
            y <= rect.y + rect.height,
        )
        .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0] ?? null
    );
  }
  // Adapt native SVG geometry to the existing stable annotation contract. No
  // iframe, cross-origin message loop, or camera-dependent coordinates.
  drawing.dataset.planrArtifactFrame = config.artifact.id;
  drawing.__openPlanrBridge = {
    hitTest(x, y) {
      const match = hitItem(x, y);
      return match
        ? { planrId: match.item.id, screen: config.artifact.id, rect: match.rect }
        : null;
    },
    resolve(id) {
      const rect = elementBounds(id);
      return rect ? { planrId: id, rect, viewport: config.artifact.viewport } : null;
    },
  };
  const pointers = new Map();
  const saveState = root.querySelector('[data-save-state]');
  let pendingReview = null,
    saving = false,
    failed = false;
  const status = (text) => {
    root.querySelector('[data-canvas-status]').textContent = text;
  };
  const emit = () =>
    root.dispatchEvent(new window.CustomEvent('planr:stage-change', { detail: { ...state } }));
  const setMode = (mode) => {
    state.reviewMode = mode;
    root.dataset.planrReviewMode = mode;
    root
      .querySelector('[data-action=pan]')
      .setAttribute('aria-pressed', String(mode === 'interact'));
    root
      .querySelector('[data-action=comment]')
      .setAttribute('aria-pressed', String(mode === 'comment'));
    status(
      mode === 'comment' ? 'Click or drag an area to comment · Esc to pan' : 'Drag anywhere to pan',
    );
    emit();
  };
  function setRail(open) {
    root.dataset.planrRailOpen = String(open);
    root.querySelector('[data-action=review]').setAttribute('aria-expanded', String(open));
    const rail = document.getElementById('planr-review-rail');
    rail.inert = !open;
    rail.setAttribute('aria-hidden', String(!open));
    if (open && window.innerWidth <= 700) setOutline(false);
  }
  function setOutline(open) {
    root.dataset.outlineOpen = String(open);
    root.querySelector('[data-action=outline]').setAttribute('aria-expanded', String(open));
    document.getElementById('diagram-outline').inert = !open;
    if (open && window.innerWidth <= 700) setRail(false);
  }
  const stage = {
    getState: () => state,
    dispatch(action) {
      if (action.type === 'set-review-mode') setMode(action.reviewMode);
      if (action.type === 'set-rail-open') setRail(action.railOpen);
    },
  };
  function draw() {
    paintId = 0;
    surface.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    surface.style.setProperty('--diagram-inverse-zoom', String(1 / camera.scale));
    root.querySelector('[data-zoom]').textContent = `${Math.round(camera.scale * 100)}%`;
  }
  const paint = () => {
    if (!paintId) paintId = window.requestAnimationFrame(draw);
  };
  // A scene that would shrink below readable size to fit its height starts at
  // fit-width instead; the reader scrolls a legible drawing rather than squinting
  // at a complete one.
  function initialFit() {
    const availableWidth = Math.max(1, canvas.clientWidth - 48);
    const availableHeight = Math.max(1, canvas.clientHeight - 116);
    const whole = Math.min(availableWidth / width, availableHeight / height);
    return whole < 0.6 && availableWidth / width > whole * 1.5 ? 'width' : 'all';
  }
  function fit(mode = 'all') {
    camera.fit = mode;
    const availableWidth = Math.max(1, canvas.clientWidth - 48);
    const availableHeight = Math.max(1, canvas.clientHeight - 116);
    camera.scale = Math.min(
      1,
      mode === 'width'
        ? availableWidth / width
        : Math.min(availableWidth / width, availableHeight / height),
    );
    camera.x = (canvas.clientWidth - width * camera.scale) / 2;
    camera.y = mode === 'width' ? 24 : 24 + (availableHeight - height * camera.scale) / 2;
    paint();
  }
  function zoom(scale, x = canvas.clientWidth / 2, y = (canvas.clientHeight - 80) / 2) {
    const next = Math.max(0.04, Math.min(4, scale));
    const ratio = next / camera.scale;
    camera.x = x - (x - camera.x) * ratio;
    camera.y = y - (y - camera.y) * ratio;
    camera.scale = next;
    camera.fit = null;
    paint();
  }
  function focusPoint(x, y, scale = Math.max(0.8, camera.scale)) {
    camera.fit = null;
    camera.scale = Math.min(2, scale);
    camera.x = canvas.clientWidth / 2 - x * camera.scale;
    camera.y = (canvas.clientHeight - 90) / 2 - y * camera.scale;
    canvas.scrollTop = 0;
    canvas.scrollLeft = 0;
    paint();
  }
  function focusBounds(bounds) {
    if (!bounds) {
      fit();
      return;
    }
    const availableWidth = Math.max(1, canvas.clientWidth - 96);
    const availableHeight = Math.max(1, canvas.clientHeight - 128);
    camera.fit = null;
    camera.scale = Math.min(
      2,
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height),
    );
    camera.x = (canvas.clientWidth - bounds.width * camera.scale) / 2 - bounds.x * camera.scale;
    camera.y = 24 + (availableHeight - bounds.height * camera.scale) / 2 - bounds.y * camera.scale;
    canvas.scrollTop = 0;
    canvas.scrollLeft = 0;
    paint();
  }
  const sections = config.items
    .filter((item) => item.kind === 'Section')
    .sort((left, right) => left.y - right.y);
  const chapters =
    sections.length > 0
      ? sections.map((item, index) => {
          const next = sections[index + 1];
          const y = Math.max(0, item.y - 46);
          return {
            id: item.id,
            label: item.label,
            bounds: {
              x: 0,
              y,
              width,
              height: Math.max(80, (next?.y ?? height) - y - (next ? 30 : 0)),
            },
          };
        })
      : config.items
          .filter((item) => item.kind === 'Group')
          .map((item) => ({ id: item.id, label: item.label, bounds: elementBounds(item.id) }));
  if (chapters.length === 0) chapters.push({ id: 'overview', label: 'Overview', bounds: null });

  function updateOutlineFilter() {
    const value = root.querySelector('[data-search]').value.trim().toLocaleLowerCase();
    let count = 0;
    root.querySelectorAll('[data-item-index]').forEach((button) => {
      const item = config.items[Number(button.dataset.itemIndex)];
      const matches = [item.label, item.id, item.description, item.kind]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(value);
      button.hidden = groupHiddenIds.has(item.id) || !matches;
      if (!button.hidden) count++;
    });
    root.querySelector('[data-search-empty]').hidden = count > 0;
  }
  function applyGroupVisibility() {
    groupHiddenIds = new Set();
    for (const id of collapsedGroups)
      for (const member of groupMembers.get(id) ?? []) groupHiddenIds.add(member);
    for (const relation of config.relations ?? []) {
      if (groupHiddenIds.has(relation.from) && groupHiddenIds.has(relation.to))
        groupHiddenIds.add(relation.id);
    }
    for (const item of config.items) {
      if (item.kind === 'Note' && item.targetId && groupHiddenIds.has(item.targetId))
        groupHiddenIds.add(item.id);
    }
    for (const [id, element] of elementIndex) {
      element.toggleAttribute('data-group-hidden', groupHiddenIds.has(id));
      if (groups.has(id)) element.toggleAttribute('data-collapsed', collapsedGroups.has(id));
    }
    updateOutlineFilter();
  }
  function expandForItem(id) {
    let changed = false;
    for (const groupId of [...collapsedGroups]) {
      if (groupMembers.get(groupId)?.has(id)) {
        collapsedGroups.delete(groupId);
        changed = true;
      }
    }
    if (changed) applyGroupVisibility();
  }
  const feedback = mountArtifactFeedbackRail({
    root,
    document,
    window,
    reviewOf: config.reviewOf,
    initialReview: config.review,
    presentation: {
      compact: true,
      pageSize: 30,
      replyLimit: 2,
      describePin: (pin) => ({ intentLabel: intentLabels[pin.intent] }),
      decorateThread({ element, pin }) {
        if (!pin.anchor?.planrId) return;
        const item = config.items[itemIndex.get(pin.anchor.planrId)];
        const target = document.createElement('p');
        target.className = 'diagram-thread-target';
        target.textContent = item
          ? `${item.kind}: ${item.label}`
          : 'Target unavailable in this revision';
        element.querySelector('header').after(target);
      },
    },
  });
  listen(root, 'planr:artifact-annotation-draft', () => {
    root
      .querySelectorAll('[data-planr-annotation-composer] [data-planr-intent]')
      .forEach((button) => {
        button.textContent = intentLabels[button.dataset.planrIntent];
      });
  });
  annotations = mountArtifactAnnotations({
    root,
    document,
    window,
    stageController: stage,
    reviewController: feedback,
    onFocusPin: (pin) => {
      if (pin.anchor?.planrId) expandForItem(pin.anchor.planrId);
      const rect = pin.anchor?.planrId && elementBounds(pin.anchor.planrId);
      const x = pin.region.x + pin.region.w / 2,
        y = pin.region.y + pin.region.h / 2;
      if (connectionFocus) {
        connectionFocus = false;
        updateSelection();
      }
      focusPoint(
        rect ? rect.x + x * rect.width : x * width,
        rect ? rect.y + y * rect.height : y * height,
      );
    },
  });

  async function save() {
    if (saving || !pendingReview) return;
    saving = true;
    failed = false;
    saveState.disabled = true;
    saveState.dataset.failed = 'false';
    saveState.textContent = 'Saving…';
    while (pendingReview) {
      const review = pendingReview;
      pendingReview = null;
      try {
        const response = await window.fetch(`${config.base}api/review`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ review }),
        });
        if (!response.ok) throw new Error('Review could not be saved');
      } catch {
        pendingReview ??= review;
        failed = true;
        saveState.disabled = false;
        saveState.dataset.failed = 'true';
        saveState.textContent = 'Save failed · click to retry';
        break;
      }
    }
    saving = false;
    if (!failed) saveState.textContent = 'Comments saved on this computer';
  }
  listen(root, 'planr:artifact-review-change', (event) => {
    pendingReview = event.detail;
    root.querySelector('[data-comment-count]').textContent = String(event.detail.pins.length);
    void save();
  });
  listen(saveState, 'click', () => {
    if (failed) void save();
  });
  listen(window, 'online', () => {
    if (failed) void save();
  });
  listen(window, 'beforeunload', (event) => {
    if (pendingReview || saving) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  function updateSelection() {
    const item = config.items[selectedIndex];
    const connected = new Set(item ? [item.id] : []);
    for (const relation of config.relations ?? []) {
      if (relation.id === item?.id || relation.from === item?.id || relation.to === item?.id) {
        connected.add(relation.id);
        connected.add(relation.from);
        connected.add(relation.to);
      }
    }
    for (const [id, element] of elementIndex) {
      element.toggleAttribute('data-selected', id === item?.id);
      if (id === item?.id) element.dataset.selected = 'true';
      element.toggleAttribute('data-dimmed', connectionFocus && !connected.has(id));
    }
    root
      .querySelector('[data-action=connections]')
      .setAttribute('aria-pressed', String(connectionFocus));
  }
  function selectItem(index, { focus = true } = {}) {
    const item = config.items[index];
    if (!item) return;
    expandForItem(item.id);
    selectedIndex = index;
    root
      .querySelectorAll('[data-item-index]')
      .forEach((button) =>
        button.setAttribute('aria-current', String(Number(button.dataset.itemIndex) === index)),
      );
    const details = root.querySelector('[data-element-details]');
    details.hidden = false;
    details.querySelector('[data-element-label]').textContent = item.label;
    details.querySelector('[data-element-kind]').textContent = item.semanticKind ?? item.kind;
    details.querySelector('[data-element-id]').textContent = item.id;
    details.querySelector('[data-element-description]').textContent =
      item.description || 'No supporting description provided.';
    details.querySelector('[data-element-endpoints]').textContent = item.from
      ? `${item.fromLabel} → ${item.toLabel}`
      : '';
    const groupToggle = root.querySelector('[data-action=toggle-group]');
    groupToggle.hidden = item.kind !== 'Group';
    groupToggle.textContent = collapsedGroups.has(item.id)
      ? 'Expand group details'
      : 'Collapse group details';
    groupToggle.setAttribute('aria-pressed', String(collapsedGroups.has(item.id)));
    root.querySelector('[data-action=connections]').disabled = !(config.relations ?? []).some(
      (relation) => relation.id === item.id || relation.from === item.id || relation.to === item.id,
    );
    updateSelection();
    if (focus) {
      if (window.innerWidth <= 700) setOutline(false);
      focusPoint(item.x, item.y);
    }
    status(item.label);
  }
  const search = root.querySelector('[data-search]');
  listen(search, 'input', updateOutlineFilter);
  listen(search, 'keydown', (event) => {
    if (event.key === 'Enter') {
      const first = root.querySelector('[data-item-index]:not([hidden])');
      if (first) selectItem(Number(first.dataset.itemIndex));
    }
  });

  function showChapter(index) {
    presentationIndex = Math.max(0, Math.min(chapters.length - 1, index));
    const chapter = chapters[presentationIndex];
    root.querySelector('[data-chapter-label]').textContent = chapter.label;
    root.querySelector('[data-chapter-progress]').textContent =
      `${presentationIndex + 1} of ${chapters.length}`;
    root.querySelector('[data-action=previous-chapter]').disabled = presentationIndex === 0;
    root.querySelector('[data-action=next-chapter]').disabled =
      presentationIndex === chapters.length - 1;
    focusBounds(chapter.bounds);
    status(`Chapter ${presentationIndex + 1} of ${chapters.length} · ${chapter.label}`);
  }
  function resetPresentation() {
    root.dataset.present = 'false';
    root.querySelector('[data-presentation-nav]').hidden = true;
    const button = root.querySelector('[data-action=present]');
    button.textContent = 'Present';
    button.setAttribute('aria-pressed', 'false');
    fit();
  }
  async function present() {
    const active = root.dataset.present !== 'true';
    root.dataset.present = String(active);
    setRail(false);
    root.querySelector('[data-presentation-nav]').hidden = !active;
    const button = root.querySelector('[data-action=present]');
    button.textContent = active ? 'Exit presentation' : 'Present';
    button.setAttribute('aria-pressed', String(active));
    try {
      if (active && root.requestFullscreen) await root.requestFullscreen();
      else if (!active && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* The same fitted workspace remains usable when fullscreen is unavailable. */
    }
    if (active) showChapter(0);
    else fit();
  }
  listen(document, 'fullscreenchange', () => {
    if (!document.fullscreenElement && root.dataset.present === 'true') resetPresentation();
  });
  const actions = {
    pan: () => setMode('interact'),
    comment: () => setMode('comment'),
    'zoom-in': () => zoom(camera.scale * 1.2),
    'zoom-out': () => zoom(camera.scale / 1.2),
    fit: () => fit(),
    width: () => fit('width'),
    actual: () => zoom(1),
    outline: () => setOutline(root.dataset.outlineOpen !== 'true'),
    review: () => setRail(root.dataset.planrRailOpen !== 'true'),
    present,
  };
  actions['previous-chapter'] = () => showChapter(presentationIndex - 1);
  actions['next-chapter'] = () => showChapter(presentationIndex + 1);
  actions.connections = () => {
    connectionFocus = !connectionFocus;
    updateSelection();
    status(
      connectionFocus
        ? 'Direct connections highlighted · Click again to show all'
        : 'Showing the complete diagram',
    );
  };
  actions['toggle-group'] = () => {
    const item = config.items[selectedIndex];
    if (item?.kind !== 'Group') return;
    if (collapsedGroups.has(item.id)) collapsedGroups.delete(item.id);
    else collapsedGroups.add(item.id);
    applyGroupVisibility();
    selectItem(selectedIndex, { focus: false });
    status(
      collapsedGroups.has(item.id)
        ? `${item.label} details collapsed`
        : `${item.label} details expanded`,
    );
  };
  actions['close-details'] = () => {
    selectedIndex = -1;
    connectionFocus = false;
    updateSelection();
    root.querySelector('[data-element-details]').hidden = true;
    root
      .querySelectorAll('[aria-current=true]')
      .forEach((element) => element.removeAttribute('aria-current'));
  };
  actions['comment-element'] = () => {
    const item = config.items[selectedIndex];
    if (!item) return;
    const rect = elementBounds(item.id);
    if (!rect) return;
    annotations.openComposer({
      artifactId: config.artifact.id,
      viewport: config.artifact.viewport,
      variant: 'diagram',
      region: {
        x: (rect.x + rect.width / 2) / width,
        y: (rect.y + rect.height / 2) / height,
        w: 0,
        h: 0,
      },
    });
  };
  listen(root, 'click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) actions[button.dataset.action]?.();
    const item = event.target.closest('[data-item-index]');
    if (item) selectItem(Number(item.dataset.itemIndex));
    if (event.target.closest('[data-planr-close-feedback]')) {
      setRail(false);
      root.querySelector('[data-action=review]').focus();
    }
    if (!event.target.closest('.diagram-export'))
      root.querySelector('.diagram-export').open = false;
  });
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function resetGesture() {
    pointers.clear();
    gesture = null;
    root.querySelector('[data-selection]').hidden = true;
    delete canvas.dataset.dragging;
  }
  function beginPinch() {
    const [a, b] = [...pointers.values()];
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture = {
      type: 'pinch',
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: camera.scale,
      diagramX: (center.x - camera.x) / camera.scale,
      diagramY: (center.y - camera.y) / camera.scale,
    };
    root.querySelector('[data-selection]').hidden = true;
  }
  listen(canvas, 'pointerdown', (event) => {
    if (
      event.target.closest('button,a,input,.diagram-canvas-tools,.planr-pin') ||
      ![0, 1].includes(event.button)
    )
      return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point(event));
    if (pointers.size === 2) {
      beginPinch();
      return;
    }
    const p = point(event);
    const comment =
      state.reviewMode === 'comment' &&
      !space &&
      event.button === 0 &&
      event.target.closest('.diagram-scene');
    gesture = {
      type: comment ? 'comment' : 'pan',
      start: p,
      x: camera.x,
      y: camera.y,
      client: { x: event.clientX, y: event.clientY },
      item: hitItem((p.x - camera.x) / camera.scale, (p.y - camera.y) / camera.scale),
    };
    if (!comment) canvas.dataset.dragging = 'true';
  });
  listen(canvas, 'pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, point(event));
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      camera.scale = Math.max(
        0.04,
        Math.min(4, (gesture.scale * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.distance),
      );
      camera.x = (a.x + b.x) / 2 - gesture.diagramX * camera.scale;
      camera.y = (a.y + b.y) / 2 - gesture.diagramY * camera.scale;
      camera.fit = null;
      paint();
      return;
    }
    const p = point(event);
    if (gesture.type === 'pan') {
      camera.fit = null;
      camera.x = gesture.x + p.x - gesture.start.x;
      camera.y = gesture.y + p.y - gesture.start.y;
      paint();
    }
    if (gesture.type === 'comment') {
      const region = clientSelectionToNormalized(surface.getBoundingClientRect(), gesture.client, {
        x: event.clientX,
        y: event.clientY,
      });
      const selection = root.querySelector('[data-selection]');
      selection.hidden = false;
      Object.assign(selection.style, {
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
      });
    }
  });
  listen(canvas, 'pointerup', (event) => {
    if (!pointers.has(event.pointerId)) return;
    if (
      gesture?.type === 'pan' &&
      gesture.item &&
      !space &&
      Math.hypot(event.clientX - gesture.client.x, event.clientY - gesture.client.y) < 4
    ) {
      selectItem(gesture.item.index, { focus: false });
      if (window.innerWidth <= 700) setOutline(true);
    }
    if (gesture?.type === 'comment' && pointers.size === 1) {
      const region = clientSelectionToNormalized(surface.getBoundingClientRect(), gesture.client, {
        x: event.clientX,
        y: event.clientY,
      });
      annotations.openComposer({
        artifactId: config.artifact.id,
        viewport: config.artifact.viewport,
        variant: 'diagram',
        region,
      });
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    resetGesture();
  });
  listen(canvas, 'pointercancel', resetGesture);
  listen(canvas, 'lostpointercapture', (event) => {
    if (pointers.has(event.pointerId)) resetGesture();
  });
  listen(window, 'blur', () => {
    space = false;
    resetGesture();
  });
  listen(
    canvas,
    'wheel',
    (event) => {
      if (event.target.closest('.diagram-canvas-tools')) return;
      event.preventDefault();
      const p = point(event);
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      if (event.ctrlKey || event.metaKey)
        zoom(camera.scale * Math.exp(-event.deltaY * units * 0.004), p.x, p.y);
      else {
        camera.fit = null;
        camera.x -= (event.shiftKey ? event.deltaY : event.deltaX) * units;
        camera.y -= (event.shiftKey ? 0 : event.deltaY) * units;
        paint();
      }
    },
    { passive: false },
  );
  listen(document, 'keydown', (event) => {
    if (
      event.target.closest(
        'input,textarea,select,[contenteditable=true],.planr-annotation-composer',
      ) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const key = event.key.toLowerCase();
    if (root.dataset.present === 'true') {
      const chapterKey = {
        arrowleft: presentationIndex - 1,
        pageup: presentationIndex - 1,
        arrowright: presentationIndex + 1,
        pagedown: presentationIndex + 1,
        home: 0,
        end: chapters.length - 1,
      }[key];
      if (chapterKey !== undefined) {
        event.preventDefault();
        showChapter(chapterKey);
        return;
      }
    }
    if (key === ' ' && !event.target.closest('button,a,summary,[role=button]')) {
      event.preventDefault();
      space = true;
    }
    const keys = {
      f: 'fit',
      0: 'fit',
      w: 'width',
      1: 'actual',
      '+': 'zoom-in',
      '=': 'zoom-in',
      '-': 'zoom-out',
      c: 'comment',
      v: 'pan',
      n: 'outline',
      p: 'present',
    };
    if (keys[key]) {
      event.preventDefault();
      actions[keys[key]]();
    }
    if (key === 'escape') {
      resetGesture();
      setMode('interact');
      root.querySelector('.diagram-export').open = false;
      if (root.dataset.present === 'true') void present();
    }
    if (document.activeElement === canvas && key.startsWith('arrow')) {
      event.preventDefault();
      camera.fit = null;
      camera.x += key === 'arrowleft' ? 60 : key === 'arrowright' ? -60 : 0;
      camera.y += key === 'arrowup' ? 60 : key === 'arrowdown' ? -60 : 0;
      paint();
    }
  });
  listen(document, 'keyup', (event) => {
    if (event.key === ' ') space = false;
  });
  let lastWidth = canvas.clientWidth,
    lastHeight = canvas.clientHeight;
  const resize = new window.ResizeObserver(() => {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (camera.fit) fit(camera.fit);
    else {
      camera.x += (w - lastWidth) / 2;
      camera.y += (h - lastHeight) / 2;
      paint();
    }
    lastWidth = w;
    lastHeight = h;
  });
  resize.observe(canvas);
  setOutline(window.innerWidth > 700);
  fit(initialFit());
  draw();
  const api = {
    camera,
    fit,
    focusPoint,
    feedback,
    annotations,
    chapters,
    collapsedGroups,
    destroy() {
      resize.disconnect();
      window.cancelAnimationFrame(paintId);
      annotations.destroy();
      feedback.destroy();
      cleanup.splice(0).forEach((remove) => remove());
    },
  };
  window.__openPlanrDiagramStudio = api;
  root.dataset.ready = 'true';
  return api;
}

if (typeof document !== 'undefined') mountDiagramStudio();
