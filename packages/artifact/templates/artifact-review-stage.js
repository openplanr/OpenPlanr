var OpenPlanrArtifactStage = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/artifact/ui/stage.mjs
  var stage_exports = {};
  __export(stage_exports, {
    ARTIFACT_STAGE_EVENTS: () => ARTIFACT_STAGE_EVENTS,
    ARTIFACT_STAGE_LIMITS: () => ARTIFACT_STAGE_LIMITS,
    bootstrapArtifactStage: () => bootstrapArtifactStage,
    clientPointToNormalized: () => clientPointToNormalized,
    createArtifactStagePayload: () => createArtifactStagePayload,
    createArtifactStageState: () => createArtifactStageState,
    mountArtifactStage: () => mountArtifactStage,
    normalizedPointToClient: () => normalizedPointToClient,
    reduceArtifactStageState: () => reduceArtifactStageState,
    resolveArtifactPresentation: () => resolveArtifactPresentation,
    visibleArtifactIds: () => visibleArtifactIds
  });

  // lib/artifact/ui/annotations.mjs
  var ARTIFACT_ANNOTATION_EVENTS = Object.freeze({
    draft: "planr:artifact-annotation-draft",
    focus: "planr:artifact-annotation-focus"
  });
  var ARTIFACT_ANNOTATION_LIMITS = Object.freeze({
    dragThreshold: 4,
    maxCommentLength: 65536,
    maxIdentityLength: 256
  });
  var INTENTS = Object.freeze(["fix", "improve", "question"]);
  function finite(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, finite(value)));
  }
  function normalized(value) {
    return Math.round(clamp(value) * 1e6) / 1e6;
  }
  function assertRect(rect) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      throw new RangeError("Artifact bounds must have positive finite dimensions.");
    }
  }
  function clientSelectionToNormalized(rect, start, end = start, { dragThreshold = ARTIFACT_ANNOTATION_LIMITS.dragThreshold } = {}) {
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
      h: normalized((bottom - top) / rect.height)
    });
  }
  function artifactAnchorPoint(region, viewport) {
    const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
    const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
    return Object.freeze({
      x: Math.round(clamp(region?.x + finite(region?.w) / 2) * width),
      y: Math.round(clamp(region?.y + finite(region?.h) / 2) * height)
    });
  }
  function annotationStyle(region) {
    const percent = (value) => `${Math.round(clamp(value) * 1e6) / 1e4}%`;
    return Object.freeze({
      left: percent(region?.x),
      top: percent(region?.y),
      width: percent(region?.w),
      height: percent(region?.h)
    });
  }
  function viewportRegionToAnchorRegion(region, viewport, anchorRect) {
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
      h: normalized(Math.max(0, Math.min(1 - y, (bottom - top) / anchorHeight)))
    });
  }
  function anchorRegionToViewportRegion(region, viewport, anchorRect) {
    const width = Number.isInteger(viewport?.width) && viewport.width > 0 ? viewport.width : 1;
    const height = Number.isInteger(viewport?.height) && viewport.height > 0 ? viewport.height : 1;
    const anchorWidth = Math.max(0, finite(anchorRect?.width));
    const anchorHeight = Math.max(0, finite(anchorRect?.height));
    return Object.freeze({
      x: normalized((finite(anchorRect?.x) + clamp(region?.x) * anchorWidth) / width),
      y: normalized((finite(anchorRect?.y) + clamp(region?.y) * anchorHeight) / height),
      w: normalized(clamp(region?.w) * anchorWidth / width),
      h: normalized(clamp(region?.h) * anchorHeight / height)
    });
  }
  function domToken(value) {
    const source = String(value);
    let token = "";
    for (let index = 0; index < source.length; index += 1) {
      token += source.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return token;
  }
  function annotationDomIds(pinId) {
    const suffix = domToken(pinId);
    return Object.freeze({
      pin: `planr-pin-${suffix}`,
      thread: `planr-thread-${suffix}`
    });
  }
  function text(value, max = ARTIFACT_ANNOTATION_LIMITS.maxCommentLength) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }
  function make(document2, tag, { className, textContent, attributes = {} } = {}) {
    const node = document2.createElement(tag);
    if (className) node.className = className;
    if (textContent !== void 0) node.textContent = textContent;
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== void 0 && value !== null) node.setAttribute(name, String(value));
    }
    return node;
  }
  function setRegionStyle(node, region) {
    const style = annotationStyle(region);
    if (node.style.left !== style.left) node.style.left = style.left;
    if (node.style.top !== style.top) node.style.top = style.top;
    if (region.w > 0 || region.h > 0) {
      if (node.style.width !== style.width) node.style.width = style.width;
      if (node.style.height !== style.height) node.style.height = style.height;
    }
  }
  function announce(document2, value) {
    const node = document2.querySelector('[data-planr-slot="review-announcer"]');
    if (node) node.textContent = value;
  }
  function identityName(reviewController) {
    return text(reviewController?.getIdentity?.()?.name, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
  }
  function createIntentPicker(document2) {
    const group = make(document2, "div", {
      className: "planr-intent-picker",
      attributes: { role: "radiogroup", "aria-label": "Feedback intent" }
    });
    for (const [index, intent] of INTENTS.entries()) {
      const button = make(document2, "button", {
        textContent: intent[0].toUpperCase() + intent.slice(1),
        attributes: {
          type: "button",
          role: "radio",
          "aria-checked": String(index === 0),
          tabindex: index === 0 ? 0 : -1,
          "data-planr-intent": intent
        }
      });
      group.append(button);
    }
    return group;
  }
  function mountArtifactAnnotations({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    root = document2?.querySelector?.(".planr-shell"),
    stageController,
    reviewController,
    onFocusPin
  } = {}) {
    if (!document2 || !window || !root || !stageController || !reviewController) return null;
    const cleanup = [];
    let draft = null;
    let suspendedDraft = null;
    let draftToken = 0;
    let draftFieldCleanup = null;
    let composerLayoutCleanup = null;
    let composerReturnFocus = null;
    const pinRecords = /* @__PURE__ */ new Map();
    const anchorRequests = /* @__PURE__ */ new Map();
    let destroyed = false;
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function review() {
      return reviewController.getReview?.() ?? reviewController.getState?.()?.review ?? reviewController.getState?.();
    }
    function layerFor(artifactId) {
      return [...document2.querySelectorAll("[data-planr-annotation-layer]")].find((node) => node.dataset.planrAnnotationLayer === artifactId) ?? null;
    }
    function frameFor(artifactId) {
      return [...document2.querySelectorAll("[data-planr-artifact-frame]")].find((node) => node.dataset.planrArtifactFrame === artifactId) ?? null;
    }
    function focusThread(pinId) {
      const pin = review()?.pins?.find((item) => item.id === pinId);
      if (!pin) return;
      reviewController.selectPin?.(pinId);
      const state = stageController.getState();
      if (state.activeArtifactId !== pin.artifactId) {
        stageController.dispatch({ type: "set-active", artifactId: pin.artifactId });
      }
      stageController.dispatch({ type: "set-rail-open", railOpen: true });
      queueMicrotask(() => document2.getElementById(annotationDomIds(pinId).thread)?.focus());
    }
    function focusPin(pinId) {
      const pin = review()?.pins?.find((item) => item.id === pinId);
      if (!pin) return;
      reviewController.selectPin?.(pinId);
      const state = stageController.getState();
      if (state.activeArtifactId !== pin.artifactId) {
        stageController.dispatch({ type: "set-active", artifactId: pin.artifactId });
      }
      queueMicrotask(() => {
        const marker = document2.getElementById(annotationDomIds(pinId).pin);
        if (marker?.hidden) {
          announce(document2, "This pin’s element is not currently visible. The original comment remains in Review.");
          return;
        }
        if (onFocusPin) onFocusPin(pin);
        else marker?.scrollIntoView?.({ block: "center", inline: "center", behavior: "smooth" });
        marker?.focus?.({ preventScroll: true });
        marker?.classList.add("planr-pin-highlight");
        window.setTimeout(() => marker?.classList.remove("planr-pin-highlight"), 1200);
      });
    }
    function pinGeometryKey(pin) {
      return JSON.stringify([
        reviewController.getReviewOf?.() ?? review()?.reviewOf,
        pin.artifactId,
        pin.anchor,
        pin.region,
        pin.viewport
      ]);
    }
    function setPinPosition(record2, region) {
      const point = { x: region.x + region.w / 2, y: region.y + region.h / 2, w: 0, h: 0 };
      setRegionStyle(record2.button, point);
      if (record2.region) setRegionStyle(record2.region, region);
      if (record2.button.hidden) record2.button.hidden = false;
      if (record2.region?.hidden) record2.region.hidden = false;
    }
    function hidePin(record2) {
      if (!record2.button.hidden) record2.button.hidden = true;
      if (record2.region && !record2.region.hidden) record2.region.hidden = true;
    }
    function removePin(record2) {
      record2.pending = null;
      record2.button.remove();
      record2.region?.remove();
    }
    function refreshAnchors() {
      if (destroyed) return;
      const now = window.performance.now();
      const frames = new Map([...document2.querySelectorAll("[data-planr-artifact-frame]")].map((frame) => [frame.dataset.planrArtifactFrame, frame]));
      const records = [...pinRecords.values()].flatMap((records2) => [...records2.values()]).filter((record2) => record2.pin.anchor?.planrId).sort((a, b) => a.requestedAt - b.requestedAt);
      for (const record2 of records) {
        if (record2.pending || now - record2.requestedAt < 200 || !record2.button.isConnected) continue;
        const frame = frames.get(record2.pin.artifactId);
        const bridge = frame?.__openPlanrBridge;
        if (!bridge?.resolve || frame.closest("[hidden]") || frame.dataset.planrBridgeTrusted === "false" || (anchorRequests.get(frame) ?? 0) >= 8) continue;
        const request = {}, key = record2.geometryKey, pin = record2.pin;
        record2.pending = request;
        record2.requestedAt = now;
        anchorRequests.set(frame, (anchorRequests.get(frame) ?? 0) + 1);
        Promise.resolve().then(() => bridge.resolve(pin.anchor.planrId, pin.anchor.screen)).then((anchor) => {
          if (destroyed || record2.pending !== request || record2.geometryKey !== key || !record2.button.isConnected || frame.__openPlanrBridge !== bridge) return;
          if (!anchor || anchor.rect.width <= 0 || anchor.rect.height <= 0) {
            hidePin(record2);
            if (record2.button.dataset.planrAnchorStatus !== "unavailable") record2.button.dataset.planrAnchorStatus = "unavailable";
            return;
          }
          const projected = anchorRegionToViewportRegion(pin.region, anchor.viewport ?? pin.viewport, anchor.rect);
          setPinPosition(record2, projected);
          if (record2.button.dataset.planrAnchorStatus !== "resolved") record2.button.dataset.planrAnchorStatus = "resolved";
        }).catch(() => {
        }).finally(() => {
          const remaining = (anchorRequests.get(frame) ?? 1) - 1;
          if (remaining > 0) anchorRequests.set(frame, remaining);
          else anchorRequests.delete(frame);
          if (record2.pending === request) record2.pending = null;
        });
      }
    }
    function renderPins() {
      if (destroyed) return;
      const pins = Array.isArray(review()?.pins) ? review().pins : [];
      const layers = new Set(document2.querySelectorAll("[data-planr-annotation-layer]"));
      for (const [layer, records] of pinRecords) {
        if (layers.has(layer)) continue;
        for (const record2 of records.values()) removePin(record2);
        pinRecords.delete(layer);
      }
      for (const layer of layers) {
        let records = pinRecords.get(layer);
        if (!records) {
          records = /* @__PURE__ */ new Map();
          pinRecords.set(layer, records);
        }
        const current = /* @__PURE__ */ new Set();
        for (const [index, pin] of pins.entries()) {
          if (pin.artifactId !== layer.dataset.planrAnnotationLayer) continue;
          current.add(pin.id);
          const ids = annotationDomIds(pin.id), ordinal = index + 1;
          const hasRegion = pin.region.w > 0 || pin.region.h > 0;
          let record2 = records.get(pin.id);
          if (!record2) {
            const button = make(document2, "button", { attributes: {
              type: "button",
              id: ids.pin,
              "data-planr-pin-id": pin.id,
              "aria-controls": ids.thread
            } });
            button.addEventListener("click", () => focusThread(pin.id));
            layer.append(button);
            record2 = { button, region: null, pin, geometryKey: null, pending: null, requestedAt: -Infinity };
            records.set(pin.id, record2);
          }
          record2.pin = pin;
          if (hasRegion && !record2.region) {
            record2.region = make(document2, "span", { attributes: { "data-planr-pin-region-id": pin.id, "aria-hidden": "true" } });
            layer.insertBefore(record2.region, record2.button);
          } else if (!hasRegion && record2.region) {
            record2.region.remove();
            record2.region = null;
          }
          const buttonClass = `planr-pin planr-pin-${pin.intent} planr-pin-${pin.status}${hasRegion ? " planr-pin-region-handle" : ""}${record2.button.classList.contains("planr-pin-highlight") ? " planr-pin-highlight" : ""}`;
          if (record2.button.className !== buttonClass) record2.button.className = buttonClass;
          if (record2.button.textContent !== String(ordinal)) record2.button.textContent = String(ordinal);
          for (const [name, value] of Object.entries({
            "data-planr-intent": pin.intent,
            "data-planr-status": pin.status,
            "aria-label": `${pin.intent} comment ${ordinal}: ${pin.comment}`
          })) {
            if (record2.button.getAttribute(name) !== value) record2.button.setAttribute(name, value);
          }
          if (record2.region) {
            const regionClass = `planr-pin-region planr-pin-region-${pin.intent} planr-pin-region-${pin.status}`;
            if (record2.region.className !== regionClass) record2.region.className = regionClass;
          }
          const key = pinGeometryKey(pin);
          if (record2.geometryKey !== key) {
            record2.geometryKey = key;
            record2.pending = null;
            record2.requestedAt = -Infinity;
            if (pin.anchor?.planrId) hidePin(record2);
            else {
              delete record2.button.dataset.planrAnchorStatus;
              setPinPosition(record2, pin.region);
            }
          }
        }
        for (const [id, record2] of records) {
          if (!current.has(id)) {
            removePin(record2);
            records.delete(id);
          }
        }
      }
      refreshAnchors();
    }
    function closeComposer({ restoreFocus = false, preserveDraft = false } = {}) {
      const snapshot = preserveDraft ? snapshotDraft() : null;
      draftFieldCleanup?.();
      draftFieldCleanup = null;
      composerLayoutCleanup?.();
      composerLayoutCleanup = null;
      const activeLayer = draft ? layerFor(draft.artifactId) : null;
      const composer = root.querySelector("[data-planr-annotation-composer]");
      try {
        if (composer?.matches(":popover-open")) composer.hidePopover();
      } catch {
      }
      composer?.remove();
      draft = null;
      suspendedDraft = snapshot;
      draftToken += 1;
      if (activeLayer && stageController.getState().reviewMode !== "comment") {
        activeLayer.setAttribute("aria-disabled", "true");
      }
      if (restoreFocus) {
        const target = composerReturnFocus?.isConnected && composerReturnFocus !== document2.body ? composerReturnFocus : activeLayer;
        target?.focus?.({ preventScroll: true });
      }
      composerReturnFocus = null;
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
            new Promise((resolve) => window.setTimeout(() => resolve(null), 800))
          ]);
        }
      } catch {
        result = null;
      }
      if (token !== draftToken || !draft || draft.artifactId !== candidate.artifactId) return;
      if (result?.planrId) {
        draft.anchor = Object.freeze({
          planrId: String(result.planrId).slice(0, 512),
          ...result.screen ? { screen: String(result.screen).slice(0, 128) } : {}
        });
        draft.region = viewportRegionToAnchorRegion(draft.region, draft.viewport, result.rect);
      }
    }
    function positionComposer() {
      const composer = root.querySelector("[data-planr-annotation-composer]");
      const layer = draft && layerFor(draft.artifactId);
      if (!composer || !layer) return;
      const visual = window.visualViewport;
      const viewport = { x: finite(visual?.offsetLeft), y: finite(visual?.offsetTop), width: finite(visual?.width, window.innerWidth), height: finite(visual?.height, window.innerHeight) };
      const margin = Math.min(12, viewport.width / 8, viewport.height / 8);
      const availableWidth = Math.max(1, viewport.width - margin * 2), availableHeight = Math.max(1, viewport.height - margin * 2);
      composer.style.width = `${Math.min(360, availableWidth)}px`;
      composer.style.maxHeight = `${Math.min(620, availableHeight)}px`;
      const bounds = layer.getBoundingClientRect();
      const point = {
        x: bounds.left + clamp(draft.displayRegion.x + draft.displayRegion.w / 2) * bounds.width,
        y: bounds.top + clamp(draft.displayRegion.y + draft.displayRegion.h / 2) * bounds.height
      };
      const size = composer.getBoundingClientRect();
      const width = Math.min(size.width || 360, availableWidth), height = Math.min(size.height || 360, availableHeight);
      const left = point.x + 16 + width <= viewport.x + viewport.width - margin ? point.x + 16 : point.x - width - 16;
      composer.style.left = `${clamp(left, viewport.x + margin, viewport.x + viewport.width - width - margin)}px`;
      composer.style.top = `${clamp(point.y + 16, viewport.y + margin, viewport.y + viewport.height - height - margin)}px`;
    }
    function openComposer(detail, { restoredDraft = null } = {}) {
      const opener = document2.activeElement;
      closeComposer();
      composerReturnFocus = opener;
      const layer = layerFor(detail.artifactId);
      if (!layer) return;
      draftToken += 1;
      const token = draftToken;
      draft = {
        artifactId: detail.artifactId,
        region: Object.freeze({ ...detail.region }),
        viewport: Object.freeze({ ...detail.viewport }),
        variant: typeof detail.variant === "string" && detail.variant.length > 0 ? detail.variant : detail.artifactId,
        anchor: restoredDraft?.anchor ?? null,
        displayRegion: Object.freeze({ ...restoredDraft?.displayRegion ?? detail.region })
      };
      const composer = make(document2, "form", {
        className: "planr-annotation-composer",
        attributes: {
          "data-planr-annotation-composer": "",
          role: "dialog",
          popover: "manual",
          "aria-label": "Add artifact comment"
        }
      });
      const header = make(document2, "header", { className: "planr-composer-header" });
      const heading = make(document2, "strong", { textContent: "New comment" });
      const close = make(document2, "button", { textContent: "×", attributes: { type: "button", "data-planr-composer-close": "", "aria-label": "Close new comment", title: "Close new comment (Escape)" } });
      header.append(heading, close);
      const identityLabel = make(document2, "label", { textContent: "Your name" });
      const identity = make(document2, "input", {
        attributes: {
          type: "text",
          maxlength: ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength,
          autocomplete: "name",
          value: identityName(reviewController),
          "data-planr-composer-identity": "",
          "aria-describedby": "planr-composer-error"
        }
      });
      identityLabel.append(identity);
      const intentPicker = createIntentPicker(document2);
      const commentLabel = make(document2, "label", { textContent: "Comment" });
      const comment = make(document2, "textarea", {
        attributes: {
          maxlength: ARTIFACT_ANNOTATION_LIMITS.maxCommentLength,
          required: "",
          placeholder: "Describe what the coding agent should change or consider…",
          "data-planr-composer-comment": "",
          "aria-describedby": "planr-composer-error"
        }
      });
      commentLabel.append(comment);
      const error = make(document2, "p", {
        className: "planr-field-error",
        attributes: { id: "planr-composer-error", role: "alert", "data-planr-composer-error": "" }
      });
      const actions = make(document2, "div", { className: "planr-composer-actions" });
      actions.append(
        make(document2, "button", {
          textContent: "Cancel",
          attributes: { type: "button", "data-planr-composer-cancel": "" }
        }),
        make(document2, "button", {
          textContent: "Add comment",
          attributes: { type: "submit", "data-planr-composer-submit": "" }
        })
      );
      composer.append(header, identityLabel, intentPicker, commentLabel, error, actions);
      root.append(composer);
      try {
        if (typeof composer.showPopover === "function") composer.showPopover();
        else composer.removeAttribute("popover");
      } catch {
        composer.removeAttribute("popover");
      }
      positionComposer();
      const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(positionComposer) : null;
      observer?.observe(composer);
      composerLayoutCleanup = () => observer?.disconnect();
      let selectedIntent = "fix";
      listen(intentPicker, "click", (event) => {
        const button = event.target.closest?.("[data-planr-intent]");
        if (!button || !INTENTS.includes(button.dataset.planrIntent)) return;
        selectedIntent = button.dataset.planrIntent;
        for (const option of intentPicker.querySelectorAll("[data-planr-intent]")) {
          option.setAttribute("aria-checked", String(option === button));
          option.tabIndex = option === button ? 0 : -1;
        }
      });
      listen(intentPicker, "keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        const options = [...intentPicker.querySelectorAll("[data-planr-intent]")];
        const current = options.findIndex((option) => option.getAttribute("aria-checked") === "true");
        const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (Math.max(0, current) + delta + options.length) % options.length;
        event.preventDefault();
        options[nextIndex].click();
        options[nextIndex].focus();
      });
      listen(close, "click", () => closeComposer({ restoreFocus: true }));
      listen(composer.querySelector("[data-planr-composer-cancel]"), "click", () => {
        closeComposer({ restoreFocus: true });
      }, { once: true });
      listen(composer, "keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeComposer({ restoreFocus: true });
        } else if (event.key === "Enter" && !event.isComposing && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          composer.requestSubmit();
        }
      });
      listen(composer, "submit", (event) => {
        event.preventDefault();
        if (!draft) return;
        const author = text(identity.value, ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength);
        const body = text(comment.value);
        identity.setAttribute("aria-invalid", String(!author));
        comment.setAttribute("aria-invalid", String(!body));
        if (!author || !body) {
          error.textContent = !author ? "Enter your name before adding a comment." : "Enter a comment before submitting.";
          (!author ? identity : comment).focus();
          return;
        }
        reviewController.setIdentity?.({ name: author });
        const existingIds = new Set(review()?.pins?.map(({ id }) => id) ?? []);
        const action = {
          type: "add-pin",
          pin: {
            artifactId: draft.artifactId,
            region: draft.region,
            viewport: draft.viewport,
            variant: draft.variant,
            ...draft.anchor ? { anchor: draft.anchor } : {},
            intent: selectedIntent,
            comment: body
          }
        };
        const next = reviewController.dispatch(action);
        const nextReview = next?.review ?? next;
        const created = nextReview?.pins?.find?.(({ id }) => !existingIds.has(id));
        closeComposer();
        renderPins();
        announce(document2, `${selectedIntent} comment added.`);
        if (created?.id) queueMicrotask(() => focusThread(created.id));
      });
      comment.focus();
      root.dispatchEvent(new window.CustomEvent(ARTIFACT_ANNOTATION_EVENTS.draft, {
        bubbles: true,
        detail: Object.freeze({ ...draft })
      }));
      if (restoredDraft) {
        identity.value = restoredDraft.identity;
        comment.value = restoredDraft.comment;
        selectedIntent = restoredDraft.intent;
        for (const option of intentPicker.querySelectorAll("[data-planr-intent]")) {
          const selected = option.dataset.planrIntent === selectedIntent;
          option.setAttribute("aria-checked", String(selected));
          option.tabIndex = selected ? 0 : -1;
        }
        if (Number.isInteger(restoredDraft.selectionStart)) comment.setSelectionRange(restoredDraft.selectionStart, restoredDraft.selectionEnd, restoredDraft.selectionDirection);
        const fields = new Map(Object.entries(restoredDraft.fields ?? {}).slice(0, 32).filter(([key, value]) => key.length <= 128 && typeof value === "string" && value.length <= ARTIFACT_ANNOTATION_LIMITS.maxCommentLength));
        if (fields.size) {
          let restoreFields = function() {
            if (token !== draftToken || !composer.isConnected) {
              finish();
              return;
            }
            for (const field of composer.querySelectorAll("[data-planr-draft-key]")) {
              const key = field.dataset.planrDraftKey;
              if (!fields.has(key) || typeof field.value !== "string") continue;
              field.value = fields.get(key);
              fields.delete(key);
              field.dispatchEvent(new window.Event("change", { bubbles: true }));
            }
            if (!fields.size) finish();
          };
          let timer;
          const observer2 = new window.MutationObserver(restoreFields);
          const finish = () => {
            observer2.disconnect();
            window.clearTimeout(timer);
          };
          observer2.observe(composer, { childList: true, subtree: true });
          timer = window.setTimeout(finish, 1500);
          draftFieldCleanup = finish;
          restoreFields();
        }
      } else void resolveAnchor(token, draft);
    }
    function snapshotDraft() {
      const composer = document2.querySelector("[data-planr-annotation-composer]");
      if (!draft || !composer) return suspendedDraft;
      const comment = composer.querySelector("[data-planr-composer-comment]");
      return Object.freeze({
        ...draft,
        reviewOf: reviewController.getReviewOf?.() ?? review()?.reviewOf ?? null,
        identity: composer.querySelector("[data-planr-composer-identity]").value,
        fields: Object.fromEntries([...composer.querySelectorAll("[data-planr-draft-key]")].slice(0, 32).filter((field) => field.dataset.planrDraftKey.length <= 128 && typeof field.value === "string").map((field) => [field.dataset.planrDraftKey, field.value.slice(0, ARTIFACT_ANNOTATION_LIMITS.maxCommentLength)])),
        comment: comment.value,
        intent: composer.querySelector('[data-planr-intent][aria-checked="true"]')?.dataset.planrIntent ?? "fix",
        selectionStart: comment.selectionStart,
        selectionEnd: comment.selectionEnd,
        selectionDirection: comment.selectionDirection
      });
    }
    function restoreDraft(snapshot) {
      if (!snapshot || snapshot.reviewOf !== (reviewController.getReviewOf?.() ?? review()?.reviewOf ?? null)) return false;
      const artifact = stageController.getState().artifacts.find((entry) => entry.id === snapshot.artifactId);
      if (!artifact || artifact.viewport.width !== snapshot.viewport?.width || artifact.viewport.height !== snapshot.viewport?.height || !["x", "y", "w", "h"].every((key) => Number.isFinite(snapshot.region?.[key]) && snapshot.region[key] >= 0 && snapshot.region[key] <= 1) || !["x", "y", "w", "h"].every((key) => Number.isFinite(snapshot.displayRegion?.[key]) && snapshot.displayRegion[key] >= 0 && snapshot.displayRegion[key] <= 1) || typeof snapshot.comment !== "string" || snapshot.comment.length > ARTIFACT_ANNOTATION_LIMITS.maxCommentLength || typeof snapshot.identity !== "string" || snapshot.identity.length > ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength || !INTENTS.includes(snapshot.intent) || snapshot.anchor && (typeof snapshot.anchor.planrId !== "string" || snapshot.anchor.planrId.length > 512)) return false;
      openComposer(snapshot, { restoredDraft: snapshot });
      return Boolean(draft);
    }
    listen(window, "resize", positionComposer);
    if (window.visualViewport) {
      listen(window.visualViewport, "resize", positionComposer);
      listen(window.visualViewport, "scroll", positionComposer);
    }
    listen(root, "planr:artifact-region", (event) => openComposer(event.detail));
    listen(root, "planr:stage-change", () => {
      const state = stageController.getState();
      const visible = state.viewMode === "split" ? [state.activeArtifactId, state.comparisonArtifactId] : [state.activeArtifactId];
      if (!draft) {
        if (suspendedDraft && state.status === "ready" && state.reviewMode === "comment" && visible.includes(suspendedDraft.artifactId)) restoreDraft(suspendedDraft);
        return;
      }
      if (state.status !== "ready" || state.presentation !== "document" && state.reviewMode !== "comment") {
        closeComposer({ preserveDraft: true });
        return;
      }
      if (!visible.includes(draft.artifactId)) closeComposer({ preserveDraft: true });
      else {
        draftToken += 1;
        positionComposer();
      }
    });
    listen(root, "planr:artifact-review-change", renderPins);
    const anchorRefresh = window.setInterval(refreshAnchors, 250);
    cleanup.push(() => window.clearInterval(anchorRefresh));
    listen(root, ARTIFACT_ANNOTATION_EVENTS.focus, (event) => {
      if (event.detail?.target === "pin") focusPin(event.detail.pinId);
      if (event.detail?.target === "thread") focusThread(event.detail.pinId);
    });
    listen(root, "planr:artifact-review-select", (event) => {
      if (event.detail?.source === "thread" && typeof event.detail?.pinId === "string") {
        focusPin(event.detail.pinId);
      }
    });
    renderPins();
    const controller = Object.freeze({
      render: renderPins,
      openComposer,
      closeComposer,
      snapshotDraft,
      restoreDraft,
      focusPin,
      focusThread,
      destroy() {
        destroyed = true;
        closeComposer();
        for (const remove of cleanup.splice(0)) remove();
        for (const records of pinRecords.values()) for (const record2 of records.values()) removePin(record2);
        pinRecords.clear();
        anchorRequests.clear();
      }
    });
    window.__openPlanrArtifactAnnotations = controller;
    return controller;
  }

  // lib/artifact/ui/feedback-rail.mjs
  var ARTIFACT_REVIEW_CHANGE_EVENT = "planr:artifact-review-change";
  var ARTIFACT_REVIEW_SELECT_EVENT = "planr:artifact-review-select";
  var ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT = "planr:artifact-review-draft-change";
  var ARTIFACT_REVIEW_LIMITS = Object.freeze({
    id: 128,
    authorName: 256,
    artifactId: 128,
    variant: 128,
    anchor: 512,
    screen: 128,
    text: 65536,
    pins: 1e4,
    replies: 1e4,
    viewport: 16384
  });
  var ARTIFACT_REVIEW_DECISIONS = Object.freeze([
    "pending",
    "approved",
    "changes_requested"
  ]);
  var ARTIFACT_REVIEW_INTENTS = Object.freeze(["fix", "improve", "question"]);
  var ARTIFACT_REVIEW_STATUSES = Object.freeze(["open", "addressed", "resolved"]);
  var REVIEW_OF_RE = /^[a-f0-9]{64}$/;
  var ArtifactReviewStateError = class extends Error {
    constructor(code, message) {
      super(message);
      this.name = "ArtifactReviewStateError";
      this.code = code;
    }
  };
  function invalid(message) {
    throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_INVALID", message);
  }
  function identityRequired() {
    throw new ArtifactReviewStateError(
      "E_ARTIFACT_REVIEW_IDENTITY_REQUIRED",
      "Enter your name before adding a comment."
    );
  }
  function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (!value || typeof value !== "object") return value;
    const clone = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = clonePlain(entry);
    return clone;
  }
  function deepFreezeArtifactReview(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const entry of Object.values(value)) deepFreezeArtifactReview(entry);
    return Object.freeze(value);
  }
  function cloneFrozenArtifactReview(review) {
    return deepFreezeArtifactReview(clonePlain(review));
  }
  function boundedString(value, label, { min = 0, max, trim = false, pattern } = {}) {
    if (typeof value !== "string") invalid(`${label} must be a string.`);
    const normalized3 = trim ? value.trim() : value;
    if (normalized3.length < min || max !== void 0 && normalized3.length > max) {
      invalid(`${label} must contain ${min} through ${max ?? "unlimited"} characters.`);
    }
    if (pattern && !pattern.test(normalized3)) invalid(`${label} has an invalid format.`);
    return normalized3;
  }
  function optionalString(value, label, options) {
    if (value === void 0) return void 0;
    return boundedString(value, label, options);
  }
  function enumValue(value, values, label) {
    if (!values.includes(value)) invalid(`${label} must be one of: ${values.join(", ")}.`);
    return value;
  }
  function isoTimestamp(value, label) {
    const timestamp = value instanceof Date ? value.toISOString() : value;
    if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
      invalid(`${label} must be an ISO-8601 date-time.`);
    }
    return timestamp;
  }
  function dependencyTimestamp(now) {
    return isoTimestamp(now(), "now()");
  }
  function defaultNow() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  function createSecureArtifactReviewId(cryptoProvider = globalThis.crypto) {
    const randomUuid = cryptoProvider?.randomUUID?.();
    if (randomUuid) return randomUuid;
    const bytes = new Uint8Array(16);
    if (typeof cryptoProvider?.getRandomValues !== "function") {
      throw new ArtifactReviewStateError(
        "E_ARTIFACT_REVIEW_UUID_UNAVAILABLE",
        "Secure UUID generation is unavailable in this browser."
      );
    }
    cryptoProvider.getRandomValues(bytes);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function defaultCreateId() {
    return createSecureArtifactReviewId();
  }
  function dependencyId(createId, kind) {
    return boundedString(createId(kind), `${kind} id`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
  }
  function uniqueDependencyId(createId, kind, existingIds) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = dependencyId(createId, kind);
      if (!existingIds.has(candidate)) return candidate;
    }
    throw new ArtifactReviewStateError(
      "E_ARTIFACT_REVIEW_ID_COLLISION",
      `Could not create a unique ${kind} id.`
    );
  }
  function normalizeArtifactReviewIdentity(value, { allowEmpty = false } = {}) {
    if (value === null || value === void 0 || value === "") {
      if (allowEmpty) return null;
      identityRequired();
    }
    const source = typeof value === "string" ? { name: value } : value;
    if (!source || typeof source !== "object" || Array.isArray(source)) identityRequired();
    const name = boundedString(source.name, "author.name", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.authorName,
      trim: true
    });
    const id = optionalString(source.id, "author.id", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
    return deepFreezeArtifactReview(id === void 0 ? { name } : { id, name });
  }
  function normalizeRegion(region) {
    if (!region || typeof region !== "object" || Array.isArray(region)) {
      invalid("pin.region must be an object.");
    }
    const unit = (value, label) => {
      if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} must be finite.`);
      return Math.round(Math.min(1, Math.max(0, value)) * 1e6) / 1e6;
    };
    const x = unit(region.x, "pin.region.x");
    const y = unit(region.y, "pin.region.y");
    const w = Math.round(Math.min(unit(region.w, "pin.region.w"), 1 - x) * 1e6) / 1e6;
    const h = Math.round(Math.min(unit(region.h, "pin.region.h"), 1 - y) * 1e6) / 1e6;
    return { x, y, w, h };
  }
  function normalizeViewport(viewport) {
    if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) {
      invalid("pin.viewport must be an object.");
    }
    const dimension = (value, label) => {
      if (!Number.isInteger(value) || value < 1 || value > ARTIFACT_REVIEW_LIMITS.viewport) {
        invalid(`${label} must be an integer from 1 through ${ARTIFACT_REVIEW_LIMITS.viewport}.`);
      }
      return value;
    };
    return {
      width: dimension(viewport.width, "pin.viewport.width"),
      height: dimension(viewport.height, "pin.viewport.height")
    };
  }
  function normalizeAnchor(anchor) {
    if (anchor === void 0 || anchor === null) return void 0;
    if (typeof anchor !== "object" || Array.isArray(anchor)) invalid("pin.anchor must be an object.");
    const planrId = boundedString(anchor.planrId, "pin.anchor.planrId", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.anchor,
      trim: true
    });
    const screen = optionalString(anchor.screen, "pin.anchor.screen", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.screen,
      trim: true
    });
    return screen === void 0 ? { planrId } : { planrId, screen };
  }
  function normalizeReply(reply, label = "reply") {
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) invalid(`${label} must be an object.`);
    return {
      id: boundedString(reply.id, `${label}.id`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.id,
        trim: true
      }),
      author: normalizeArtifactReviewIdentity(reply.author),
      comment: boundedString(reply.comment, `${label}.comment`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.text,
        trim: true
      }),
      createdAt: isoTimestamp(reply.createdAt, `${label}.createdAt`)
    };
  }
  function compareTimestampThenId(left, right) {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  }
  function normalizePin(pin, label = "pin") {
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) invalid(`${label} must be an object.`);
    if (!Array.isArray(pin.replies) || pin.replies.length > ARTIFACT_REVIEW_LIMITS.replies) {
      invalid(`${label}.replies must contain no more than ${ARTIFACT_REVIEW_LIMITS.replies} items.`);
    }
    const replies = pin.replies.map((reply, index) => normalizeReply(reply, `${label}.replies[${index}]`));
    const replyIds = new Set(replies.map(({ id }) => id));
    if (replyIds.size !== replies.length) invalid(`${label}.replies must have unique ids.`);
    const normalized3 = {
      id: boundedString(pin.id, `${label}.id`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.id,
        trim: true
      }),
      author: normalizeArtifactReviewIdentity(pin.author),
      artifactId: boundedString(pin.artifactId, `${label}.artifactId`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.artifactId,
        trim: true
      }),
      region: normalizeRegion(pin.region),
      viewport: normalizeViewport(pin.viewport),
      intent: enumValue(pin.intent, ARTIFACT_REVIEW_INTENTS, `${label}.intent`),
      status: enumValue(pin.status, ARTIFACT_REVIEW_STATUSES, `${label}.status`),
      comment: boundedString(pin.comment, `${label}.comment`, {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.text,
        trim: true
      }),
      replies: replies.sort(compareTimestampThenId),
      createdAt: isoTimestamp(pin.createdAt, `${label}.createdAt`),
      updatedAt: isoTimestamp(pin.updatedAt, `${label}.updatedAt`)
    };
    const variant = optionalString(pin.variant, `${label}.variant`, {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.variant,
      trim: true
    });
    const anchor = normalizeAnchor(pin.anchor);
    if (variant !== void 0) normalized3.variant = variant;
    if (anchor !== void 0) normalized3.anchor = anchor;
    return normalized3;
  }
  function normalizeArtifactReview(review) {
    if (!review || typeof review !== "object" || Array.isArray(review)) {
      invalid("Artifact review must be an object.");
    }
    if (!Array.isArray(review.pins) || review.pins.length > ARTIFACT_REVIEW_LIMITS.pins) {
      invalid(`review.pins must contain no more than ${ARTIFACT_REVIEW_LIMITS.pins} items.`);
    }
    const pins = review.pins.map((pin, index) => normalizePin(pin, `review.pins[${index}]`));
    const pinIds = new Set(pins.map(({ id }) => id));
    if (pinIds.size !== pins.length) invalid("review.pins must have unique ids.");
    const normalized3 = {
      schemaVersion: enumValue(review.schemaVersion, ["1.0.0"], "review.schemaVersion"),
      reviewId: boundedString(review.reviewId, "review.reviewId", {
        min: 1,
        max: ARTIFACT_REVIEW_LIMITS.id,
        trim: true
      }),
      reviewOf: boundedString(review.reviewOf, "review.reviewOf", {
        min: 64,
        max: 64,
        pattern: REVIEW_OF_RE
      }),
      decision: enumValue(review.decision, ARTIFACT_REVIEW_DECISIONS, "review.decision"),
      overall: boundedString(review.overall, "review.overall", {
        max: ARTIFACT_REVIEW_LIMITS.text
      }),
      pins: pins.sort(compareTimestampThenId)
    };
    if (review.createdAt !== void 0) normalized3.createdAt = isoTimestamp(review.createdAt, "review.createdAt");
    if (review.updatedAt !== void 0) normalized3.updatedAt = isoTimestamp(review.updatedAt, "review.updatedAt");
    return deepFreezeArtifactReview(normalized3);
  }
  function createArtifactReview({ reviewId, reviewOf, createId = defaultCreateId } = {}) {
    const normalizedReviewId = reviewId === void 0 ? dependencyId(createId, "review") : boundedString(reviewId, "reviewId", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
    return normalizeArtifactReview({
      schemaVersion: "1.0.0",
      reviewId: normalizedReviewId,
      reviewOf: boundedString(reviewOf, "reviewOf", {
        min: 64,
        max: 64,
        pattern: REVIEW_OF_RE
      }),
      decision: "pending",
      overall: "",
      pins: []
    });
  }
  function replacePin(review, pin) {
    return review.pins.map((candidate) => candidate.id === pin.id ? pin : candidate);
  }
  function findPin(review, pinId) {
    const normalizedId = boundedString(pinId, "pinId", {
      min: 1,
      max: ARTIFACT_REVIEW_LIMITS.id,
      trim: true
    });
    const pin = review.pins.find(({ id }) => id === normalizedId);
    if (!pin) {
      throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_PIN_NOT_FOUND", `Unknown feedback pin: ${normalizedId}`);
    }
    return pin;
  }
  function preserveOptionalReviewTimestamps(review, next, timestamp) {
    if (review.createdAt !== void 0) next.createdAt = review.createdAt;
    if (review.updatedAt !== void 0) next.updatedAt = timestamp;
    return next;
  }
  function reduceArtifactReview(review, action, {
    createId = defaultCreateId,
    now = defaultNow
  } = {}) {
    const current = normalizeArtifactReview(review);
    if (!action || typeof action !== "object" || Array.isArray(action)) invalid("Review action must be an object.");
    const timestamp = dependencyTimestamp(now);
    let next;
    switch (action.type) {
      case "add-pin": {
        if (current.pins.length >= ARTIFACT_REVIEW_LIMITS.pins) {
          invalid(`A review can contain at most ${ARTIFACT_REVIEW_LIMITS.pins} pins.`);
        }
        const author = normalizeArtifactReviewIdentity(action.author);
        const pinInput = action.pin && typeof action.pin === "object" ? action.pin : {};
        const pinId = pinInput.id === void 0 ? uniqueDependencyId(createId, "pin", new Set(current.pins.map(({ id }) => id))) : boundedString(pinInput.id, "pin.id", {
          min: 1,
          max: ARTIFACT_REVIEW_LIMITS.id,
          trim: true
        });
        if (current.pins.some(({ id }) => id === pinId)) {
          throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_ID_COLLISION", `Duplicate pin id: ${pinId}`);
        }
        const pin = normalizePin({
          ...pinInput,
          id: pinId,
          author,
          status: pinInput.status ?? "open",
          replies: [],
          createdAt: pinInput.createdAt ?? timestamp,
          updatedAt: pinInput.updatedAt ?? timestamp
        });
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          pins: [...current.pins, pin]
        }, timestamp);
        break;
      }
      case "add-reply": {
        const pin = findPin(current, action.pinId);
        if (pin.replies.length >= ARTIFACT_REVIEW_LIMITS.replies) {
          invalid(`A feedback thread can contain at most ${ARTIFACT_REVIEW_LIMITS.replies} replies.`);
        }
        const replyId = action.id === void 0 ? uniqueDependencyId(createId, "reply", new Set(pin.replies.map(({ id }) => id))) : boundedString(action.id, "reply.id", {
          min: 1,
          max: ARTIFACT_REVIEW_LIMITS.id,
          trim: true
        });
        if (pin.replies.some(({ id }) => id === replyId)) {
          throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_ID_COLLISION", `Duplicate reply id: ${replyId}`);
        }
        const reply = normalizeReply({
          id: replyId,
          author: normalizeArtifactReviewIdentity(action.author),
          comment: action.comment,
          createdAt: action.createdAt ?? timestamp
        });
        const updatedPin = normalizePin({
          ...pin,
          replies: [...pin.replies, reply],
          updatedAt: timestamp
        });
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          pins: replacePin(current, updatedPin)
        }, timestamp);
        break;
      }
      case "set-status": {
        const pin = findPin(current, action.pinId);
        const updatedPin = normalizePin({
          ...pin,
          status: enumValue(action.status, ARTIFACT_REVIEW_STATUSES, "status"),
          updatedAt: timestamp
        });
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          pins: replacePin(current, updatedPin)
        }, timestamp);
        break;
      }
      case "set-overall":
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          overall: boundedString(action.overall, "overall", { max: ARTIFACT_REVIEW_LIMITS.text })
        }, timestamp);
        break;
      case "set-decision":
        next = preserveOptionalReviewTimestamps(current, {
          ...current,
          decision: enumValue(action.decision, ARTIFACT_REVIEW_DECISIONS, "decision")
        }, timestamp);
        break;
      default:
        throw new ArtifactReviewStateError(
          "E_ARTIFACT_REVIEW_ACTION_UNKNOWN",
          `Unknown artifact review action: ${String(action.type)}`
        );
    }
    return normalizeArtifactReview(next);
  }
  function createArtifactReviewController({
    initialReview = null,
    reviewOf,
    reviewId,
    identity = null,
    createId = defaultCreateId,
    now = defaultNow
  } = {}) {
    let review = initialReview === null || initialReview === void 0 ? null : normalizeArtifactReview(initialReview);
    if (review && reviewOf !== void 0 && review.reviewOf !== reviewOf) {
      throw new ArtifactReviewStateError(
        "E_ARTIFACT_REVIEW_DIGEST_MISMATCH",
        "The initial review does not match the artifact envelope digest."
      );
    }
    let localIdentity = normalizeArtifactReviewIdentity(identity, { allowEmpty: true });
    let activePinId = null;
    let destroyed = false;
    const listeners = /* @__PURE__ */ new Set();
    const assertAlive = () => {
      if (destroyed) {
        throw new ArtifactReviewStateError("E_ARTIFACT_REVIEW_DESTROYED", "Artifact review controller is destroyed.");
      }
    };
    const ensureReview = () => {
      review ??= createArtifactReview({ reviewId, reviewOf, createId });
      return review;
    };
    const getState = () => deepFreezeArtifactReview({
      review,
      identity: localIdentity,
      activePinId
    });
    const notify = (change) => {
      const state = getState();
      for (const listener of [...listeners]) listener(state, deepFreezeArtifactReview({ ...change }));
    };
    const controller = {
      getReview() {
        return review;
      },
      getState,
      getIdentity() {
        return localIdentity;
      },
      setIdentity(value) {
        assertAlive();
        localIdentity = normalizeArtifactReviewIdentity(value, { allowEmpty: true });
        notify({ type: "identity" });
        return localIdentity;
      },
      dispatch(action) {
        assertAlive();
        const authored = action?.type === "add-pin" || action?.type === "add-reply";
        const nextAction = authored && action.author === void 0 ? { ...action, author: localIdentity ?? identityRequired() } : action;
        const previousPinIds = nextAction?.type === "add-pin" ? new Set(review?.pins.map(({ id }) => id) ?? []) : null;
        review = reduceArtifactReview(ensureReview(), nextAction, { createId, now });
        if (previousPinIds) {
          activePinId = review.pins.find(({ id }) => !previousPinIds.has(id))?.id ?? activePinId;
        }
        notify({ type: "review", action: nextAction.type });
        return review;
      },
      replaceReview(value) {
        assertAlive();
        const next = value === null || value === void 0 ? null : normalizeArtifactReview(value);
        if (next && reviewOf !== void 0 && next.reviewOf !== reviewOf) {
          throw new ArtifactReviewStateError(
            "E_ARTIFACT_REVIEW_DIGEST_MISMATCH",
            "The replacement review does not match the artifact envelope digest."
          );
        }
        review = next;
        if (activePinId && !review?.pins.some(({ id }) => id === activePinId)) activePinId = null;
        notify({ type: "review-replaced" });
        return review;
      },
      selectPin(pinId) {
        assertAlive();
        if (pinId === null || pinId === void 0) {
          activePinId = null;
        } else {
          activePinId = findPin(ensureReview(), pinId).id;
        }
        notify({ type: "selection" });
        return activePinId;
      },
      subscribe(listener) {
        assertAlive();
        if (typeof listener !== "function") invalid("Review subscriber must be a function.");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        listeners.clear();
        review = null;
        localIdentity = null;
        activePinId = null;
      }
    };
    return Object.freeze(controller);
  }
  function createElement(document2, tagName, { className, text: text3, attributes = {} } = {}) {
    const element = document2.createElement(tagName);
    if (className) element.className = className;
    if (text3 !== void 0) element.textContent = text3;
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== void 0 && value !== null) element.setAttribute(name, String(value));
    }
    return element;
  }
  function artifactReviewThreadDomId(pinId) {
    return annotationDomIds(pinId).thread;
  }
  function displayTimestamp(timestamp) {
    const canonical = new Date(timestamp).toISOString();
    return `${canonical.slice(0, 10)} ${canonical.slice(11, 16)} UTC`;
  }
  function renderReply(document2, reply) {
    const item = createElement(document2, "li", { className: "planr-reply", attributes: { "data-planr-reply-id": reply.id } });
    const heading = createElement(document2, "header");
    heading.append(createElement(document2, "strong", { text: reply.author.name }));
    const time = createElement(document2, "time", {
      text: displayTimestamp(reply.createdAt),
      attributes: { datetime: reply.createdAt }
    });
    heading.append(time);
    item.append(heading, createElement(document2, "p", { text: reply.comment }));
    return item;
  }
  function renderReplyForm(document2, pin, expanded = false) {
    const fieldId = `${annotationDomIds(pin.id).thread}-reply`;
    const wrapper = createElement(document2, "div", { className: "planr-reply-editor" });
    const toggle = createElement(document2, "button", {
      className: "planr-reply-toggle",
      text: expanded ? "− Reply" : "+ Reply",
      attributes: {
        type: "button",
        id: `${fieldId}-toggle`,
        "data-planr-reply-toggle": pin.id,
        "aria-expanded": String(expanded),
        "aria-controls": `${fieldId}-form`,
        title: expanded ? "Collapse reply" : "Reply to this comment"
      }
    });
    const form = createElement(document2, "form", {
      className: "planr-reply-form",
      attributes: { "data-planr-reply-form": pin.id, id: `${fieldId}-form`, ...expanded ? {} : { hidden: "" } }
    });
    const label = createElement(document2, "label", {
      className: "planr-reply-label",
      text: "Reply to thread",
      attributes: { for: fieldId }
    });
    const textarea = createElement(document2, "textarea", {
      attributes: {
        id: fieldId,
        name: "reply",
        maxlength: ARTIFACT_REVIEW_LIMITS.text,
        rows: 2,
        placeholder: "Write a reply…",
        required: "",
        "aria-describedby": "planr-review-error"
      }
    });
    const controls = createElement(document2, "div", { className: "planr-reply-controls" });
    const hint = createElement(document2, "span", { className: "planr-reply-hint", text: "Ctrl/⌘ + Enter to send" });
    const submit = createElement(document2, "button", {
      className: "planr-reply-send",
      attributes: { type: "submit", disabled: "", "aria-label": "Send reply", title: "Send reply (Ctrl/⌘ + Enter)" }
    });
    const svg = document2.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(name, value);
    const path = document2.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 19V5m-6 6 6-6 6 6");
    svg.append(path);
    submit.append(svg);
    controls.append(hint, submit);
    form.append(label, textarea, controls);
    wrapper.append(toggle, form);
    return wrapper;
  }
  function renderThread(document2, pin, active, description = {}) {
    const intentLabel = typeof description.intentLabel === "string" ? description.intentLabel.slice(0, 128) : pin.intent;
    const article = createElement(document2, "article", {
      className: `planr-thread${active ? " is-active" : ""}`,
      attributes: {
        id: artifactReviewThreadDomId(pin.id),
        tabindex: "-1",
        "data-planr-pin-id": pin.id,
        "data-planr-intent": pin.intent,
        "data-planr-status": pin.status,
        "aria-controls": annotationDomIds(pin.id).pin,
        "aria-label": `${intentLabel} comment by ${pin.author.name}`,
        "data-planr-unread": description.unread === true ? "true" : "false",
        ...description.compact ? { "data-planr-compact": "true" } : {}
      }
    });
    const header = createElement(document2, "header");
    const byline = createElement(document2, "div", { className: "planr-review-byline" });
    byline.append(
      createElement(document2, "strong", { text: pin.author.name }),
      createElement(document2, "span", { className: "planr-intent", text: intentLabel })
    );
    const time = createElement(document2, "time", {
      text: description.compact ? `${new Date(pin.createdAt).toISOString().slice(11, 16)} UTC` : displayTimestamp(pin.createdAt),
      attributes: { datetime: pin.createdAt, title: displayTimestamp(pin.createdAt) }
    });
    header.append(byline, time);
    const comment = createElement(document2, "p", {
      className: "planr-thread-comment",
      text: pin.comment
    });
    const lifecycle = createElement(document2, "div", { className: "planr-thread-actions" });
    lifecycle.append(
      createElement(document2, "span", { className: "planr-thread-status", text: pin.status, attributes: { title: `Status: ${pin.status}` } }),
      createElement(document2, "button", {
        text: pin.status === "resolved" ? "Reopen" : "Resolve",
        attributes: {
          type: "button",
          "data-planr-thread-action": pin.status === "resolved" ? "reopen" : "resolve",
          "data-planr-pin-id": pin.id
        }
      }),
      createElement(document2, "button", {
        text: "Show pin",
        attributes: {
          type: "button",
          "data-planr-thread-focus": pin.id,
          "aria-controls": annotationDomIds(pin.id).pin
        }
      })
    );
    const replies = createElement(document2, "ol", {
      className: "planr-replies",
      attributes: { "aria-label": "Replies" }
    });
    const earlierReplies = description.compact ? Math.max(0, pin.replies.length - (description.replyLimit || 2)) : 0;
    for (const reply of pin.replies.slice(earlierReplies)) replies.append(renderReply(document2, reply));
    const editor = renderReplyForm(document2, pin, description.replyExpanded);
    article.append(header, comment);
    if (description.compact && pin.comment.length > 240) {
      comment.dataset.planrCommentCollapsed = String(!description.commentExpanded);
      article.append(createElement(document2, "button", { className: "planr-comment-expand", text: description.commentExpanded ? "Show less" : "Read full comment", attributes: { type: "button", id: `${annotationDomIds(pin.id).thread}-expand`, "data-planr-comment-expand": pin.id, "aria-expanded": String(Boolean(description.commentExpanded)) } }));
    }
    if (earlierReplies) article.append(createElement(document2, "button", { className: "planr-history-expand", text: `Show ${earlierReplies} earlier ${earlierReplies === 1 ? "reply" : "replies"}`, attributes: { type: "button", id: `${annotationDomIds(pin.id).thread}-history`, "data-planr-history-expand": pin.id, "aria-expanded": "false" } }));
    if (pin.replies.length) article.append(replies);
    if (description.compact) {
      lifecycle.append(editor.querySelector("[data-planr-reply-toggle]"));
      article.append(lifecycle, editor);
    } else article.append(lifecycle, editor);
    return article;
  }
  function decisionCopy(decision) {
    if (decision === "approved") return "Review approved";
    if (decision === "changes_requested") return "Changes requested";
    return "Decision pending";
  }
  function mountArtifactFeedbackRail({
    root,
    document: document2 = root?.ownerDocument,
    window = document2?.defaultView,
    controller: providedController,
    initialReview = null,
    reviewOf,
    reviewId,
    identity = null,
    createId = defaultCreateId,
    now = defaultNow,
    onSelectPin,
    presentation: initialPresentation = {}
  } = {}) {
    if (!root || !document2 || !window) invalid("A browser root, document, and window are required.");
    const slot = root.querySelector('[data-planr-slot="feedback-rail"]');
    const identityInput = root.querySelector("[data-planr-reviewer-name]");
    const identityStatus = root.querySelector("[data-planr-identity-status]");
    const overall = root.querySelector("#planr-overall-note");
    const decisionStatus = root.querySelector('[data-planr-slot="decision-status"]');
    const decisionButtons = [...root.querySelectorAll("[data-planr-decision]")];
    if (!slot || !identityInput || !overall || !decisionStatus || decisionButtons.length === 0) {
      invalid("Artifact feedback renderer slots are missing.");
    }
    const ownsController = !providedController;
    const controller = providedController ?? createArtifactReviewController({
      initialReview,
      reviewOf,
      reviewId,
      identity,
      createId,
      now
    });
    let destroyed = false;
    let presentation = { ...initialPresentation };
    const replyDrafts = /* @__PURE__ */ new Map();
    const expandedReplies = /* @__PURE__ */ new Set();
    const expandedHistory = /* @__PURE__ */ new Map(), expandedComments = /* @__PURE__ */ new Set();
    let visibleLimit = Number.isInteger(initialPresentation.pageSize) ? initialPresentation.pageSize : Infinity;
    const extraDrafts = /* @__PURE__ */ new Map();
    let overallDirty = false;
    let composing = false;
    let renderQueued = false;
    const captureDrafts = () => {
      for (const form of slot.querySelectorAll("[data-planr-reply-form]")) {
        const field = form.elements.namedItem("reply");
        if (field) replyDrafts.set(form.dataset.planrReplyForm, field.value);
      }
      for (const field of slot.querySelectorAll("[data-planr-draft-key]")) {
        if (typeof field.value === "string") extraDrafts.set(field.dataset.planrDraftKey, field.value);
      }
    };
    const snapshotDrafts = () => {
      captureDrafts();
      return cloneFrozenArtifactReview({
        reviewOf: controller.getReview()?.reviewOf ?? reviewOf,
        replies: Object.fromEntries(replyDrafts),
        expandedReplies: [...expandedReplies],
        fields: Object.fromEntries(extraDrafts),
        overall: { value: overall.value, dirty: overallDirty },
        identity: identityInput.value
      });
    };
    const emitDraftChange = () => root.dispatchEvent(new window.CustomEvent(ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT, { bubbles: true, detail: snapshotDrafts() }));
    const focusDescriptor = () => {
      const element = document2.activeElement;
      if (!element || !slot.contains(element)) return null;
      const thread = element.closest("[data-planr-pin-id]");
      return {
        id: element.id,
        pinId: thread?.dataset.planrPinId,
        draftKey: element.dataset.planrDraftKey,
        action: element.dataset.planrThreadAction,
        showPin: element.dataset.planrThreadFocus,
        tag: element.tagName,
        name: element.name,
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection
      };
    };
    const restoreFocus = (descriptor) => {
      if (!descriptor) return;
      const thread = descriptor.pinId && document2.getElementById(artifactReviewThreadDomId(descriptor.pinId));
      const target = descriptor.id && document2.getElementById(descriptor.id) || descriptor.draftKey && [...slot.querySelectorAll("[data-planr-draft-key]")].find((field) => field.dataset.planrDraftKey === descriptor.draftKey) || descriptor.action && [...thread?.querySelectorAll("[data-planr-thread-action]") ?? []].find((button) => button.dataset.planrThreadAction === descriptor.action) || descriptor.showPin && thread?.querySelector("[data-planr-thread-focus]") || [...thread?.querySelectorAll("button,input,select,textarea") ?? []].find((field) => field.tagName === descriptor.tag && field.name === descriptor.name);
      target?.focus?.({ preventScroll: true });
      if (Number.isInteger(descriptor.start)) target?.setSelectionRange?.(descriptor.start, descriptor.end, descriptor.direction);
    };
    const showError = (error) => {
      const target = root.querySelector("#planr-review-error");
      if (!target) return;
      target.textContent = error?.message ?? String(error);
      target.hidden = false;
    };
    const clearError = () => {
      const target = root.querySelector("#planr-review-error");
      if (!target) return;
      target.textContent = "";
      target.hidden = true;
    };
    const announce2 = (message) => {
      decisionStatus.textContent = message;
      const live = root.parentElement?.querySelector('[data-planr-slot="review-announcer"]') ?? document2.querySelector('[data-planr-slot="review-announcer"]');
      if (live) live.textContent = message;
    };
    const updateCounts = (pins) => {
      const label = `${pins.length} ${pins.length === 1 ? "comment" : "comments"}`;
      for (const count2 of root.querySelectorAll('[data-planr-action="feedback"] .planr-count, .planr-review-rail > header .planr-count')) {
        count2.textContent = String(pins.length);
        count2.setAttribute("aria-label", label);
      }
      const commentsButton = root.querySelector('[data-planr-action="feedback"]');
      commentsButton?.setAttribute("aria-label", commentsButton.dataset.planrReviewLabel || label);
      if (commentsButton?.dataset.planrReviewLabel) commentsButton.setAttribute("aria-description", label);
    };
    const render = ({ capture = true } = {}) => {
      if (composing) {
        renderQueued = true;
        return;
      }
      if (capture) captureDrafts();
      const focus = focusDescriptor();
      const scroll = [];
      for (let node = slot; node && root.contains(node); node = node.parentElement) scroll.push([node, node.scrollTop, node.scrollLeft]);
      const state = controller.getState();
      const { review, activePinId } = state;
      const allPins = review?.pins ?? [];
      const pins = typeof presentation.filterPin === "function" ? allPins.filter((pin) => presentation.filterPin(pin, state)) : allPins;
      const activeIndex = pins.findIndex((pin) => pin.id === activePinId);
      const visiblePins = pins.slice(0, visibleLimit);
      if (activeIndex >= visibleLimit) visiblePins.push(pins[activeIndex]);
      const fragment = document2.createDocumentFragment();
      const list = createElement(document2, "div", {
        className: "planr-thread-list",
        attributes: { "aria-label": "Comment threads" }
      });
      if (pins.length === 0) {
        list.append(createElement(document2, "p", {
          className: "planr-review-empty",
          text: typeof presentation.emptyMessage === "string" ? presentation.emptyMessage : allPins.length ? "No comments match these filters." : "No comments yet. Choose Add comment, then select a point or region in the artifact."
        }));
      } else {
        for (const pin of visiblePins) {
          const thread = renderThread(document2, pin, pin.id === activePinId, { ...presentation.describePin?.(pin, state), compact: presentation.compact === true, replyLimit: expandedHistory.get(pin.id) || 2, commentExpanded: expandedComments.has(pin.id), replyExpanded: expandedReplies.has(pin.id) });
          presentation.decorateThread?.({ element: thread, pin, state, document: document2 });
          const reply = thread.querySelector('[name="reply"]');
          if (replyDrafts.has(pin.id)) reply.value = replyDrafts.get(pin.id);
          thread.querySelector(".planr-reply-send").disabled = !reply.value.trim();
          for (const field of thread.querySelectorAll("[data-planr-draft-key]")) {
            if (extraDrafts.has(field.dataset.planrDraftKey)) field.value = extraDrafts.get(field.dataset.planrDraftKey);
          }
          list.append(thread);
        }
      }
      if (pins.length > visibleLimit) list.append(createElement(document2, "button", { className: "planr-threads-more", text: `Show more comments · ${Math.min(visibleLimit, pins.length)} of ${pins.length}`, attributes: { type: "button", "data-planr-threads-more": "" } }));
      fragment.append(list);
      slot.replaceChildren(fragment);
      const identityName2 = controller.getIdentity()?.name ?? "";
      if (document2.activeElement !== identityInput) identityInput.value = identityName2;
      if (identityStatus) {
        identityStatus.dataset.planrIdentityReady = String(Boolean(identityName2));
        identityStatus.textContent = identityName2 ? `Comments will appear as ${identityName2}.` : "Used to sign your comments.";
      }
      overall.maxLength = ARTIFACT_REVIEW_LIMITS.text;
      if (!overallDirty && document2.activeElement !== overall) overall.value = review?.overall ?? "";
      for (const button of decisionButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.planrDecision === (review?.decision ?? "pending")));
      }
      decisionStatus.textContent = decisionCopy(review?.decision ?? "pending");
      updateCounts(allPins);
      restoreFocus(focus);
      for (const [node, top, left] of scroll) {
        node.scrollTop = top;
        node.scrollLeft = left;
      }
      const openMetric = root.querySelector('[data-planr-metric="open"]');
      if (openMetric) openMetric.textContent = `${allPins.filter(({ status }) => status !== "resolved").length} open`;
    };
    const focusThread = (pinId) => {
      const thread = document2.getElementById(artifactReviewThreadDomId(pinId));
      thread?.focus({ preventScroll: true });
      thread?.scrollIntoView?.({ block: "nearest" });
    };
    const emitReview = (review) => {
      const detail = cloneFrozenArtifactReview(review);
      root.dispatchEvent(new window.CustomEvent(ARTIFACT_REVIEW_CHANGE_EVENT, {
        detail,
        bubbles: true
      }));
    };
    const unsubscribe = controller.subscribe((state, change) => {
      if (destroyed) return;
      if (["review", "review-replaced", "selection"].includes(change.type)) render();
      if (["review", "review-replaced"].includes(change.type) && state.review) emitReview(state.review);
    });
    const onInput = (event) => {
      if (event.target !== identityInput) return;
      try {
        controller.setIdentity(event.target.value ? { name: event.target.value } : null);
        const name = controller.getIdentity()?.name ?? "";
        if (identityStatus) {
          identityStatus.dataset.planrIdentityReady = String(Boolean(name));
          identityStatus.textContent = name ? `Comments will appear as ${name}.` : "Used to sign your comments.";
        }
        clearError();
      } catch (error) {
        showError(error);
      }
    };
    const setReplyExpanded = (pinId, expanded, { focus = false } = {}) => {
      const thread = document2.getElementById(artifactReviewThreadDomId(pinId));
      const form = thread?.querySelector("[data-planr-reply-form]");
      const toggle = thread?.querySelector("[data-planr-reply-toggle]");
      if (!form || !toggle) return;
      if (expanded) expandedReplies.add(pinId);
      else expandedReplies.delete(pinId);
      form.hidden = !expanded;
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.textContent = expanded ? "− Reply" : "+ Reply";
      toggle.title = expanded ? "Collapse reply" : "Reply to this comment";
      if (focus) (expanded ? form.elements.namedItem("reply") : toggle).focus({ preventScroll: true });
      emitDraftChange();
    };
    const onKeyDown = (event) => {
      const form = event.target?.closest?.("[data-planr-reply-form]");
      if (!form || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setReplyExpanded(form.dataset.planrReplyForm, false, { focus: true });
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (form.elements.namedItem("reply").value.trim()) form.requestSubmit();
      }
    };
    const emitSelection = (pinId) => {
      controller.selectPin(pinId);
      root.dispatchEvent(new window.CustomEvent(ARTIFACT_REVIEW_SELECT_EVENT, {
        detail: deepFreezeArtifactReview({ pinId, source: "thread" }),
        bubbles: true
      }));
      onSelectPin?.(pinId);
    };
    const onClick = (event) => {
      if (event.target.closest?.("[data-planr-threads-more]")) {
        visibleLimit += presentation.pageSize || 40;
        render();
        return;
      }
      const historyToggle = event.target.closest?.("[data-planr-history-expand]");
      if (historyToggle) {
        const id = historyToggle.dataset.planrHistoryExpand;
        expandedHistory.set(id, (expandedHistory.get(id) || 2) + 20);
        render();
        return;
      }
      const commentToggle = event.target.closest?.("[data-planr-comment-expand]");
      if (commentToggle) {
        const id = commentToggle.dataset.planrCommentExpand;
        if (expandedComments.has(id)) expandedComments.delete(id);
        else expandedComments.add(id);
        render();
        return;
      }
      const replyToggle = event.target?.closest?.("[data-planr-reply-toggle]");
      if (replyToggle) {
        setReplyExpanded(replyToggle.dataset.planrReplyToggle, replyToggle.getAttribute("aria-expanded") !== "true", { focus: true });
        return;
      }
      const action = event.target?.closest?.("[data-planr-thread-action]");
      const focus = event.target?.closest?.("[data-planr-thread-focus]");
      if (action) {
        try {
          const pinId = action.dataset.planrPinId;
          controller.dispatch({
            type: "set-status",
            pinId,
            status: action.dataset.planrThreadAction === "resolve" ? "resolved" : "open"
          });
          announce2(action.dataset.planrThreadAction === "resolve" ? "Comment resolved" : "Comment reopened");
          focusThread(pinId);
          clearError();
        } catch (error) {
          showError(error);
        }
        return;
      }
      if (focus) emitSelection(focus.dataset.planrThreadFocus);
    };
    const onSubmit = (event) => {
      const form = event.target?.closest?.("[data-planr-reply-form]");
      if (!form) return;
      event.preventDefault();
      const textarea = form.elements.namedItem("reply");
      const comment = textarea.value;
      if (!comment.trim()) return;
      const wasExpanded = expandedReplies.has(form.dataset.planrReplyForm);
      try {
        textarea.setAttribute("aria-invalid", "false");
        textarea.value = "";
        replyDrafts.delete(form.dataset.planrReplyForm);
        expandedReplies.delete(form.dataset.planrReplyForm);
        controller.dispatch({
          type: "add-reply",
          pinId: form.dataset.planrReplyForm,
          comment
        });
        emitDraftChange();
        announce2("Reply added");
        focusThread(form.dataset.planrReplyForm);
        clearError();
      } catch (error) {
        textarea.value = comment;
        replyDrafts.set(form.dataset.planrReplyForm, comment);
        if (wasExpanded) expandedReplies.add(form.dataset.planrReplyForm);
        textarea?.setAttribute("aria-invalid", "true");
        showError(error);
        textarea?.focus();
      }
    };
    const onOverallChange = () => {
      try {
        const value = overall.value;
        controller.dispatch({ type: "set-overall", overall: value });
        overallDirty = false;
        announce2("Overall note updated");
        clearError();
      } catch (error) {
        showError(error);
      }
    };
    const onDecision = (event) => {
      try {
        const selected = event.currentTarget.dataset.planrDecision;
        const decision = controller.getReview()?.decision === selected ? "pending" : selected;
        controller.dispatch({ type: "set-decision", decision });
        announce2(decisionCopy(decision));
        clearError();
      } catch (error) {
        showError(error);
      }
    };
    const onSelect = (event) => {
      if (event.detail?.source === "thread" || typeof event.detail?.pinId !== "string") return;
      try {
        controller.selectPin(event.detail.pinId);
        focusThread(event.detail.pinId);
      } catch (error) {
        showError(error);
      }
    };
    let lastOpened = null;
    const onThreadOpen = (event) => {
      const thread = event.target.closest?.(".planr-thread[data-planr-pin-id]");
      if (!thread || !slot.contains(thread)) return;
      const pin = controller.getReview()?.pins.find((entry) => entry.id === thread.dataset.planrPinId);
      const key = pin && `${pin.id}:${pin.replies.map((reply) => reply.id).join(",")}`;
      if (!key || lastOpened === key) return;
      lastOpened = key;
      presentation.onThreadOpen?.(pin.id, controller.getState());
      root.dispatchEvent(new window.CustomEvent("planr:artifact-thread-open", { bubbles: true, detail: Object.freeze({ pinId: pin.id }) }));
    };
    const onDraftInput = (event) => {
      const form = event.target.closest?.("[data-planr-reply-form]");
      if (form) form.querySelector(".planr-reply-send").disabled = !form.elements.namedItem("reply").value.trim();
      emitDraftChange();
    };
    const onOverallInput = () => {
      overallDirty = true;
      emitDraftChange();
    };
    const onCompositionStart = () => {
      composing = true;
    };
    const onCompositionEnd = () => {
      composing = false;
      if (renderQueued) {
        renderQueued = false;
        render();
      }
    };
    slot.addEventListener("input", onDraftInput);
    slot.addEventListener("focusin", onThreadOpen);
    slot.addEventListener("click", onThreadOpen);
    slot.addEventListener("compositionstart", onCompositionStart);
    slot.addEventListener("compositionend", onCompositionEnd);
    overall.addEventListener("input", onOverallInput);
    identityInput.addEventListener("input", onInput);
    slot.addEventListener("click", onClick);
    slot.addEventListener("submit", onSubmit);
    slot.addEventListener("keydown", onKeyDown);
    overall.addEventListener("change", onOverallChange);
    for (const button of decisionButtons) button.addEventListener("click", onDecision);
    root.addEventListener(ARTIFACT_REVIEW_SELECT_EVENT, onSelect);
    render();
    return Object.freeze({
      controller,
      getReview: () => controller.getReview(),
      getState: () => controller.getState(),
      getIdentity: () => controller.getIdentity(),
      setIdentity: (value) => controller.setIdentity(value),
      dispatch: (action) => controller.dispatch(action),
      replaceReview: (review) => controller.replaceReview(review),
      selectPin: (pinId) => controller.selectPin(pinId),
      render,
      setPresentation(options = {}) {
        if (options.filterKey !== presentation.filterKey || options.pageSize !== void 0 && options.pageSize !== presentation.pageSize) visibleLimit = options.pageSize || presentation.pageSize || Infinity;
        presentation = { ...presentation, ...options };
        render();
      },
      snapshotDrafts,
      getReviewOf: () => controller.getReview()?.reviewOf ?? reviewOf,
      restoreDrafts(snapshot) {
        const digest = controller.getReview()?.reviewOf ?? reviewOf;
        if (!snapshot || snapshot.reviewOf !== digest) return false;
        if (typeof snapshot.identity === "string") {
          const name = snapshot.identity.slice(0, ARTIFACT_REVIEW_LIMITS.authorName);
          controller.setIdentity(name.trim() ? { ...controller.getIdentity(), name } : null);
        }
        for (const [id, value] of Object.entries(snapshot.replies ?? {}).slice(0, ARTIFACT_REVIEW_LIMITS.pins)) {
          if (id.length <= ARTIFACT_REVIEW_LIMITS.id && typeof value === "string") replyDrafts.set(id, value.slice(0, ARTIFACT_REVIEW_LIMITS.text));
        }
        expandedReplies.clear();
        const expanded = Array.isArray(snapshot.expandedReplies) ? snapshot.expandedReplies : [...replyDrafts.keys()];
        for (const id of expanded.slice(0, ARTIFACT_REVIEW_LIMITS.pins)) if (typeof id === "string" && id.length <= ARTIFACT_REVIEW_LIMITS.id) expandedReplies.add(id);
        for (const [key, value] of Object.entries(snapshot.fields ?? {}).slice(0, ARTIFACT_REVIEW_LIMITS.pins)) {
          if (key.length <= 512 && typeof value === "string") extraDrafts.set(key, value.slice(0, ARTIFACT_REVIEW_LIMITS.text));
        }
        overallDirty = snapshot.overall?.dirty === true;
        if (overallDirty && typeof snapshot.overall?.value === "string") overall.value = snapshot.overall.value.slice(0, ARTIFACT_REVIEW_LIMITS.text);
        render({ capture: false });
        return true;
      },
      focusThread,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        unsubscribe();
        slot.removeEventListener("input", onDraftInput);
        slot.removeEventListener("focusin", onThreadOpen);
        slot.removeEventListener("click", onThreadOpen);
        slot.removeEventListener("compositionstart", onCompositionStart);
        slot.removeEventListener("compositionend", onCompositionEnd);
        overall.removeEventListener("input", onOverallInput);
        identityInput.removeEventListener("input", onInput);
        slot.removeEventListener("click", onClick);
        slot.removeEventListener("submit", onSubmit);
        slot.removeEventListener("keydown", onKeyDown);
        overall.removeEventListener("change", onOverallChange);
        for (const button of decisionButtons) button.removeEventListener("click", onDecision);
        root.removeEventListener(ARTIFACT_REVIEW_SELECT_EVENT, onSelect);
        if (ownsController) controller.destroy();
      }
    });
  }

  // lib/artifact/ui/share-dialog.mjs
  var ARTIFACT_SHARE_FRAGMENT_LIMIT = 8e3;
  var ARTIFACT_SHARE_TTLS = Object.freeze({
    "1d": Object.freeze({ label: "1 day", milliseconds: 864e5 }),
    "7d": Object.freeze({ label: "7 days", milliseconds: 6048e5 }),
    "30d": Object.freeze({ label: "30 days", milliseconds: 2592e6 })
  });
  var ARTIFACT_SHARE_TRANSPORTS = Object.freeze(["live", "fragment", "short"]);
  var PHASES = Object.freeze([
    "idle",
    "previewing",
    "ready",
    "custody-preparing",
    "custody-ready",
    "creating",
    "ambiguous",
    "created",
    "error"
  ]);
  var LIVE_ROOM_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
  var LIVE_ROOM_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
  var LIVE_ROOM_KEY_ID_RE = /^sha256:[a-f0-9]{64}$/;
  var LIVE_ROOM_REVIEW_RE = /^[a-f0-9]{64}$/;
  var BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
  var OWNER_SECRET_MAX_BYTES = 64 * 1024;
  var ArtifactShareUiError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "ArtifactShareUiError";
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  };
  function member(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }
  function count(value, name) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_PREVIEW_INVALID",
        `${name} must be a non-negative integer.`,
        { field: name }
      );
    }
    return value;
  }
  function text2(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }
  function record(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function exactKeys(value, expected) {
    return record(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  }
  function exactLoopback(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  }
  function parseLiveResultUrl(value, capability) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Live room creation returned a malformed capability URL."
      );
    }
    const fields = new URLSearchParams(url.hash.slice(1));
    const keys = [...fields.keys()];
    const roomId = /^\/r\/([A-Za-z0-9_-]{16,128})\/?$/.exec(url.pathname)?.[1];
    if (url.username || url.password || url.search || url.protocol !== "https:" && !(url.protocol === "http:" && exactLoopback(url.hostname)) || !roomId || !LIVE_ROOM_ID_RE.test(roomId) || keys.length !== 2 || !keys.includes("k") || !keys.includes(capability) || keys.some((key) => !["k", capability].includes(key) || fields.getAll(key).length !== 1) || !LIVE_ROOM_SECRET_RE.test(fields.get("k") ?? "") || !LIVE_ROOM_SECRET_RE.test(fields.get(capability) ?? "")) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Live room creation returned an invalid or mixed capability URL."
      );
    }
    return Object.freeze({
      origin: url.origin,
      pathname: url.pathname.replace(/\/$/, ""),
      key: fields.get("k"),
      capability: fields.get(capability)
    });
  }
  function validateLiveResultUrls({ url, ownerUrl, manageUrl }) {
    const reviewer = parseLiveResultUrl(url, "w");
    const owner = parseLiveResultUrl(ownerUrl, "o");
    const management = parseLiveResultUrl(manageUrl, "m");
    if (reviewer.origin !== owner.origin || reviewer.origin !== management.origin || reviewer.pathname !== owner.pathname || reviewer.pathname !== management.pathname || reviewer.key !== owner.key || reviewer.key !== management.key || (/* @__PURE__ */ new Set([reviewer.capability, owner.capability, management.capability])).size !== 3) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Live room creation must return separate reviewer, owner-verdict, and management capabilities for one room."
      );
    }
  }
  function normalizeOwnerCustody(value) {
    if (record(value?.prepared) && record(value?.recovery)) {
      const { prepared, recovery } = value;
      if (!exactKeys(prepared, [
        "schemaVersion",
        "kind",
        "protocolVersion",
        "id",
        "roomId",
        "reviewOf",
        "ttl",
        "ownerKey"
      ]) || prepared.schemaVersion !== "1.0.0" || prepared.kind !== "openplanr-live-room-preparation" || prepared.protocolVersion !== "2.0.0" || prepared.id !== prepared.roomId || !LIVE_ROOM_ID_RE.test(prepared.roomId ?? "") || !LIVE_ROOM_REVIEW_RE.test(prepared.reviewOf ?? "") || !Object.hasOwn(ARTIFACT_SHARE_TTLS, prepared.ttl) || !record(prepared.ownerKey) || !exactKeys(prepared.ownerKey, ["algorithm", "encoding", "keyId", "value"]) || !record(prepared.ownerSigner) || !exactKeys(recovery, [
        "schemaVersion",
        "kind",
        "protocolVersion",
        "id",
        "roomId",
        "reviewOf",
        "ttl",
        "ownerKey",
        "url",
        "ownerUrl",
        "manageUrl",
        "ownerSigner"
      ]) || recovery.schemaVersion !== "1.0.0" || recovery.kind !== "openplanr-live-room-recovery" || recovery.protocolVersion !== "2.0.0" || recovery.id !== prepared.id || recovery.roomId !== prepared.roomId || recovery.reviewOf !== prepared.reviewOf || recovery.ttl !== prepared.ttl || JSON.stringify(recovery.ownerKey) !== JSON.stringify(prepared.ownerKey) || recovery.url !== prepared.url || recovery.ownerUrl !== prepared.ownerUrl || recovery.manageUrl !== prepared.manageUrl) {
        throw new ArtifactShareUiError(
          "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
          "Live room recovery custody does not match its prepared creation."
        );
      }
      validateLiveResultUrls(recovery);
      const signerCustody = normalizeOwnerCustody({
        signer: prepared.ownerSigner,
        secret: recovery.ownerSigner
      });
      if (prepared.ownerKey.algorithm !== signerCustody.signer.algorithm || prepared.ownerKey.encoding !== signerCustody.signer.encoding || prepared.ownerKey.keyId !== signerCustody.signer.keyId || prepared.ownerKey.value !== (signerCustody.signer.value ?? signerCustody.signer.publicKey)) {
        throw new ArtifactShareUiError(
          "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
          "Live room recovery owner key does not match its prepared signer."
        );
      }
      const serialized2 = `${JSON.stringify(recovery, null, 2)}
`;
      const byteLength2 = new TextEncoder().encode(serialized2).byteLength;
      if (byteLength2 < 2 || byteLength2 > OWNER_SECRET_MAX_BYTES) {
        throw new ArtifactShareUiError(
          "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
          "Live room recovery bundle exceeds its bounded export size."
        );
      }
      return Object.freeze({
        credential: prepared,
        signer: signerCustody.signer,
        serialized: serialized2,
        filename: `openplanr-live-room-recovery-${prepared.roomId.slice(0, 12)}.json`
      });
    }
    if (!record(value) || !record(value.signer) || !record(value.secret)) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
        "Live room owner custody could not be prepared safely."
      );
    }
    const { signer, secret } = value;
    if (signer.role !== "owner" || typeof signer.sign !== "function" || signer.algorithm !== "ECDSA-P256-SHA256" || signer.encoding !== "spki-base64url" || !LIVE_ROOM_KEY_ID_RE.test(signer.keyId ?? "") || !BASE64URL_RE.test(signer.value ?? signer.publicKey ?? "") || (signer.value ?? signer.publicKey).length < 64 || (signer.value ?? signer.publicKey).length > 512) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
        "Live room owner signer is invalid."
      );
    }
    if (!exactKeys(secret, [
      "schemaVersion",
      "kind",
      "role",
      "algorithm",
      "keyId",
      "publicKey",
      "privateKey"
    ]) || secret.schemaVersion !== "1.0.0" || secret.kind !== "openplanr-live-room-signer" || secret.role !== "owner" || secret.algorithm !== "ECDSA-P256-SHA256" || secret.keyId !== signer.keyId || secret.publicKey !== (signer.value ?? signer.publicKey) || !BASE64URL_RE.test(secret.publicKey ?? "") || !BASE64URL_RE.test(secret.privateKey ?? "") || secret.publicKey.length < 64 || secret.publicKey.length > 512 || secret.privateKey.length < 64 || secret.privateKey.length > 1024) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
        "Live room owner secret does not match its signer."
      );
    }
    const serialized = `${JSON.stringify(secret, null, 2)}
`;
    const byteLength = new TextEncoder().encode(serialized).byteLength;
    if (byteLength < 2 || byteLength > OWNER_SECRET_MAX_BYTES) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_INVALID",
        "Live room owner secret exceeds its bounded export size."
      );
    }
    return Object.freeze({
      credential: signer,
      signer,
      serialized,
      filename: `openplanr-live-room-owner-${signer.keyId.slice(7, 19)}.json`
    });
  }
  function defaultSaveOwnerCustody(document2, window, { filename, serialized }) {
    if (typeof window?.Blob !== "function" || typeof window?.URL?.createObjectURL !== "function" || typeof window?.URL?.revokeObjectURL !== "function" || typeof document2?.createElement !== "function" || !document2.body) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE",
        "This browser cannot save the private owner key. No room was created."
      );
    }
    const blobUrl = window.URL.createObjectURL(new window.Blob(
      [serialized],
      { type: "application/json;charset=utf-8" }
    ));
    try {
      const anchor = document2.createElement("a");
      anchor.hidden = true;
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.rel = "noreferrer";
      document2.body.append(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE",
        "The private owner key could not be handed to the browser download manager. No room was created.",
        { cause: error?.name }
      );
    } finally {
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 0);
    }
    return true;
  }
  async function establishArtifactOwnerCustody({ prepareOwnerCustody, saveOwnerCustody } = {}) {
    if (typeof prepareOwnerCustody !== "function" || typeof saveOwnerCustody !== "function") {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_REQUIRED",
        "Live room creation requires explicit private owner-key custody. No room was created."
      );
    }
    const custody = normalizeOwnerCustody(await prepareOwnerCustody());
    const saved = await saveOwnerCustody(Object.freeze({
      filename: custody.filename,
      serialized: custody.serialized
    }));
    if (saved !== true && saved?.saved !== true) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_OWNER_CUSTODY_UNAVAILABLE",
        "Private owner-key custody was not confirmed. No room was created."
      );
    }
    return custody.credential;
  }
  function frozenResult(value) {
    if (!value || typeof value !== "object" || typeof value.url !== "string" || value.url.length === 0) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Share creation must return a non-empty review URL."
      );
    }
    if (!ARTIFACT_SHARE_TRANSPORTS.includes(value.transport)) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Share creation must return a known transport.",
        { field: "transport" }
      );
    }
    const deletionToken = text2(value.deletionToken);
    const ownerUrl = text2(value.ownerUrl);
    const manageUrl = text2(value.manageUrl);
    if (deletionToken && value.url.includes(deletionToken)) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_DELETION_TOKEN_LEAK",
        "The deletion token must never be included in the review URL."
      );
    }
    if (value.transport === "live") {
      validateLiveResultUrls({ url: value.url, ownerUrl, manageUrl });
    } else if (ownerUrl || manageUrl) {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_RESULT_INVALID",
        "Snapshot creation cannot return live room capabilities."
      );
    }
    return Object.freeze({
      transport: value.transport,
      url: value.url,
      ownerUrl,
      manageUrl,
      deletionToken,
      expiresAt: text2(value.expiresAt)
    });
  }
  function normalizeArtifactSharePreview(value = {}) {
    const preview = value && typeof value === "object" ? value : {};
    const fragmentLength = count(preview.fragmentLength, "fragmentLength");
    return Object.freeze({
      fragmentLength,
      compressedBytes: count(preview.compressedBytes, "compressedBytes"),
      ciphertextBytes: count(preview.ciphertextBytes, "ciphertextBytes"),
      fragmentEligible: fragmentLength <= ARTIFACT_SHARE_FRAGMENT_LIMIT
    });
  }
  function freezeState(value) {
    return Object.freeze({
      open: Boolean(value.open),
      phase: member(value.phase, PHASES, "idle"),
      transport: member(value.transport, ARTIFACT_SHARE_TRANSPORTS, "live"),
      ttl: Object.hasOwn(ARTIFACT_SHARE_TTLS, value.ttl) ? value.ttl : "7d",
      preview: value.preview ? normalizeArtifactSharePreview(value.preview) : null,
      ownerCustodyEstablished: Boolean(value.ownerCustodyEstablished),
      result: value.result ? frozenResult(value.result) : null,
      error: text2(value.error)
    });
  }
  function createArtifactShareDialogState({ preview, ttl = "7d" } = {}) {
    const normalizedPreview = preview ? normalizeArtifactSharePreview(preview) : null;
    return freezeState({
      open: false,
      phase: normalizedPreview ? "ready" : "idle",
      transport: "live",
      ttl,
      preview: normalizedPreview,
      ownerCustodyEstablished: false,
      result: null,
      error: ""
    });
  }
  function reduceArtifactShareDialog(state, action = {}) {
    const current = state ?? createArtifactShareDialogState();
    if (current.phase === "created" && action.type !== "close") return current;
    if (current.phase === "ambiguous" && !["create-start", "create-success", "failure"].includes(action.type)) return current;
    if (current.phase === "custody-ready" && ["select-transport", "set-ttl"].includes(action.type)) return current;
    switch (action.type) {
      case "open":
        return freezeState({ ...current, open: true, ownerCustodyEstablished: false, result: null, error: "" });
      case "close":
        return freezeState({ ...current, open: false, phase: current.preview ? "ready" : "idle", ownerCustodyEstablished: false, error: "" });
      case "preview-start":
        return freezeState({ ...current, open: true, phase: "previewing", preview: null, ownerCustodyEstablished: false, result: null, error: "" });
      case "preview-ready": {
        const preview = normalizeArtifactSharePreview(action.preview);
        return freezeState({
          ...current,
          phase: "ready",
          preview,
          ownerCustodyEstablished: false,
          transport: current.transport === "fragment" && !preview.fragmentEligible ? "short" : current.transport,
          result: null,
          error: ""
        });
      }
      case "select-transport": {
        const transport = member(action.transport, ARTIFACT_SHARE_TRANSPORTS, current.transport);
        if (transport === "fragment" && current.preview?.fragmentEligible === false) return current;
        return transport === current.transport ? current : freezeState({
          ...current,
          phase: current.preview ? "ready" : "idle",
          transport,
          ownerCustodyEstablished: false,
          result: null,
          error: ""
        });
      }
      case "set-ttl": {
        const ttl = Object.hasOwn(ARTIFACT_SHARE_TTLS, action.ttl) ? action.ttl : current.ttl;
        return ttl === current.ttl ? current : freezeState({ ...current, ttl, result: null, error: "" });
      }
      case "custody-start":
        return freezeState({ ...current, phase: "custody-preparing", ownerCustodyEstablished: false, result: null, error: "" });
      case "custody-ready":
        return freezeState({ ...current, phase: "custody-ready", ownerCustodyEstablished: true, result: null, error: "" });
      case "create-start":
        return freezeState({ ...current, phase: "creating", result: null, error: "" });
      case "create-success":
        return freezeState({ ...current, phase: "created", result: action.result, error: "" });
      case "failure":
        return freezeState({
          ...current,
          phase: action.ambiguous ? "ambiguous" : "error",
          ownerCustodyEstablished: Boolean(action.ownerCustodyEstablished),
          result: null,
          error: text2(action.error, "Share creation failed.")
        });
      default:
        return current;
    }
  }
  function artifactShareExpiry(ttl, now = /* @__PURE__ */ new Date()) {
    const choice = ARTIFACT_SHARE_TTLS[ttl] ?? ARTIFACT_SHARE_TTLS["7d"];
    const base = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(base)) throw new TypeError("Share expiry requires a valid date.");
    return new Date(base + choice.milliseconds).toISOString();
  }
  function formatArtifactShareBytes(value) {
    const bytes = count(value, "bytes");
    if (bytes < 1e3) return `${bytes} B`;
    if (bytes < 1e6) return `${(bytes / 1e3).toFixed(bytes >= 1e4 ? 0 : 1)} KB`;
    return `${(bytes / 1e6).toFixed(1)} MB`;
  }
  function focusableElements(dialog) {
    return [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.hidden && !element.closest("[hidden]"));
  }
  function defaultCopy(window, value) {
    if (typeof window?.navigator?.clipboard?.writeText !== "function") {
      throw new ArtifactShareUiError(
        "E_ARTIFACT_SHARE_CLIPBOARD_UNAVAILABLE",
        "Clipboard access is unavailable. Copy the value manually."
      );
    }
    return window.navigator.clipboard.writeText(value);
  }
  function reviewForShare(stageController) {
    return stageController?.review?.getReview?.() ?? null;
  }
  function artifactShareCapabilities({ prepareShare, prepareOwnerCustody, createShare, supportedTransports } = {}) {
    const canCreate = typeof prepareShare === "function" && typeof createShare === "function";
    return Object.freeze(ARTIFACT_SHARE_TRANSPORTS.filter((transport) => canCreate && (transport !== "live" || typeof prepareOwnerCustody === "function") && (supportedTransports === void 0 || Array.isArray(supportedTransports) && supportedTransports.includes(transport))));
  }
  function mountArtifactShareDialog({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    root = document2?.querySelector?.(".planr-shell"),
    stageController,
    prepareShare,
    prepareOwnerCustody,
    saveOwnerCustody,
    createShare,
    supportedTransports,
    unavailableReason,
    copyText,
    existingRoom = false,
    existingShareUrl = null,
    now = () => /* @__PURE__ */ new Date()
  } = {}) {
    if (!document2 || !window || !root) return null;
    const backdrop = document2.querySelector("[data-planr-share-dialog]");
    const dialog = backdrop?.querySelector('[role="dialog"]');
    const trigger = root.querySelector('[data-planr-action="share"]');
    if (!backdrop || !dialog || !trigger) return null;
    let state = createArtifactShareDialogState();
    const capabilities = artifactShareCapabilities({ prepareShare, prepareOwnerCustody, createShare, supportedTransports });
    const unavailable = text2(unavailableReason) || "Sharing is not configured in this viewer. Open the review with an updated OpenPlanr installation that supports sharing.";
    let returnFocus = null;
    let generation = 0;
    let pendingOwnerCustody = null;
    const copyResetTimers = /* @__PURE__ */ new Map();
    const cleanup = [];
    const handlers = {
      prepareShare: typeof prepareShare === "function" ? prepareShare : null,
      prepareOwnerCustody: typeof prepareOwnerCustody === "function" ? prepareOwnerCustody : null,
      saveOwnerCustody: typeof saveOwnerCustody === "function" ? saveOwnerCustody : (value) => defaultSaveOwnerCustody(document2, window, value),
      createShare: typeof createShare === "function" ? createShare : null,
      copyText: typeof copyText === "function" ? copyText : (value) => defaultCopy(window, value)
    };
    const stableShareUrl = typeof existingShareUrl === "function" ? existingShareUrl : () => existingShareUrl;
    function supports(transport) {
      return capabilities.includes(transport) && (transport !== "fragment" || state.preview?.fragmentEligible !== false);
    }
    function selectSupportedTransport() {
      if (!supports(state.transport)) {
        const transport = capabilities.find(supports);
        if (transport) state = reduceArtifactShareDialog(state, { type: "select-transport", transport });
      }
    }
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function announce2(message) {
      const live = dialog.querySelector("[data-planr-share-status]");
      if (live) live.textContent = message;
    }
    function resetCopyButton(button) {
      const timer = copyResetTimers.get(button);
      if (timer) window.clearTimeout(timer);
      copyResetTimers.delete(button);
      button.removeAttribute("data-planr-copy-state");
      const label = button.querySelector?.(".planr-action-label");
      if (label) label.textContent = button.dataset.planrCopyLabel ?? label.textContent;
      else button.textContent = button.dataset.planrCopyLabel ?? button.textContent;
    }
    function showCopyState(button, stateValue) {
      if (!button) return;
      const label = button.querySelector?.(".planr-action-label");
      if (!button.dataset.planrCopyLabel) {
        button.dataset.planrCopyLabel = (label?.textContent ?? button.textContent).trim();
      }
      const prior = copyResetTimers.get(button);
      if (prior) window.clearTimeout(prior);
      button.dataset.planrCopyState = stateValue;
      if (label) label.textContent = stateValue === "copied" ? "Copied" : "Try again";
      else button.textContent = stateValue === "copied" ? "Copied" : "Try again";
      copyResetTimers.set(button, window.setTimeout(() => resetCopyButton(button), 1800));
    }
    function resetCopyButtons() {
      for (const button of dialog.querySelectorAll("[data-planr-copy-state]")) resetCopyButton(button);
    }
    function clearPendingOwnerSigner() {
      pendingOwnerCustody = null;
    }
    function pendingOwnerSigner() {
      return pendingOwnerCustody?.ownerSigner ?? pendingOwnerCustody;
    }
    async function copyExistingRoom() {
      const value = stableShareUrl();
      if (!value) return;
      try {
        await handlers.copyText(value);
        showCopyState(trigger, "copied");
        announce2("Live review URL copied. This remains the same collaboration room.");
      } catch (error) {
        showCopyState(trigger, "error");
        announce2(error?.message ?? "Review URL could not be copied.");
      }
    }
    function render() {
      const preview = state.preview;
      backdrop.hidden = !state.open;
      backdrop.style.pointerEvents = state.open ? "auto" : "";
      root.toggleAttribute("inert", state.open);
      root.setAttribute("aria-hidden", String(state.open));
      if (!state.open) root.removeAttribute("aria-hidden");
      dialog.dataset.planrSharePhase = state.phase;
      dialog.dataset.planrShareSelected = state.transport;
      for (const button of dialog.querySelectorAll("[data-planr-share-transport]")) {
        const transport = button.dataset.planrShareTransport;
        const selected = transport === state.transport;
        button.hidden = state.phase === "created";
        button.setAttribute("aria-pressed", String(selected));
        button.classList.toggle("is-selected", selected);
        button.disabled = ["previewing", "custody-preparing", "custody-ready", "creating", "ambiguous", "created"].includes(state.phase) || !supports(transport);
        button.setAttribute("aria-disabled", String(button.disabled));
        button.title = capabilities.includes(transport) ? "" : transport === "live" && capabilities.length ? "Live review requires this host to provide private owner-key custody. Choose an available snapshot option." : unavailable;
        if (transport === "live") button.querySelector(".planr-share-receipt-size").textContent = capabilities.includes("live") ? "Default" : "Unavailable";
      }
      const fragmentSize = dialog.querySelector("[data-planr-share-fragment-size]");
      if (fragmentSize) fragmentSize.textContent = !capabilities.includes("fragment") ? "Unavailable" : preview ? `${preview.fragmentLength.toLocaleString("en-US")} chars · ${formatArtifactShareBytes(preview.compressedBytes)}` : state.phase === "previewing" ? "Calculating…" : "Size unavailable";
      const shortSize = dialog.querySelector("[data-planr-share-short-size]");
      if (shortSize) shortSize.textContent = !capabilities.includes("short") ? "Unavailable" : preview ? formatArtifactShareBytes(preview.ciphertextBytes) : state.phase === "previewing" ? "Calculating…" : "Size unavailable";
      const threshold = dialog.querySelector("[data-planr-share-threshold]");
      if (threshold) {
        threshold.hidden = !capabilities.includes("fragment");
        threshold.textContent = preview?.fragmentEligible === false ? `Private fragment snapshot unavailable (${preview.fragmentLength.toLocaleString("en-US")} characters; 8,000 limit). Choose an available sharing option.` : preview ? "Private fragment snapshot available for links up to 8,000 characters." : "Preparing the snapshot size before sharing.";
      }
      const ttlRow = dialog.querySelector("[data-planr-share-ttl-row]");
      if (ttlRow) ttlRow.hidden = state.phase === "created" || !supports(state.transport) || !["live", "short"].includes(state.transport);
      const ttlSelect2 = dialog.querySelector("[data-planr-share-ttl]");
      if (ttlSelect2) {
        ttlSelect2.value = state.ttl;
        ttlSelect2.disabled = ["custody-preparing", "custody-ready", "creating", "ambiguous", "created"].includes(state.phase);
      }
      const expiry = artifactShareExpiry(state.ttl, now());
      const expiryNode = dialog.querySelector("[data-planr-share-expiry]");
      if (expiryNode) {
        expiryNode.dateTime = expiry;
        expiryNode.textContent = new Intl.DateTimeFormat("en", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC"
        }).format(new Date(expiry));
      }
      const primary = dialog.querySelector("[data-planr-share-confirm]");
      if (primary) {
        primary.hidden = state.phase === "created";
        primary.disabled = !supports(state.transport) || !preview && state.phase !== "error" || state.phase === "previewing" || state.phase === "custody-preparing" || state.phase === "creating" || state.phase === "created";
        primary.textContent = !supports(state.transport) ? "Sharing unavailable" : state.phase === "error" && !preview ? "Retry preparation" : state.phase === "custody-preparing" ? "Preparing owner key…" : state.phase === "creating" ? "Creating…" : state.phase === "ambiguous" ? "Retry exact room creation" : state.transport === "live" ? state.ownerCustodyEstablished ? state.phase === "error" ? "Retry live review room" : "I saved it — create live room" : "Download recovery bundle" : state.transport === "short" ? "Create encrypted link" : "Copy private link";
      }
      for (const closeControl of dialog.querySelectorAll("[data-planr-share-close], [data-planr-share-cancel]")) {
        const closeBlocked = state.phase === "creating" || state.phase === "ambiguous";
        closeControl.disabled = closeBlocked;
        closeControl.setAttribute("aria-disabled", String(closeBlocked));
      }
      const custody = dialog.querySelector("[data-planr-share-owner-custody]");
      if (custody) custody.hidden = state.transport !== "live" || !supports("live") || state.phase === "created";
      const custodyStatus = dialog.querySelector("[data-planr-share-owner-custody-status]");
      if (custodyStatus) custodyStatus.textContent = state.ownerCustodyEstablished ? "Full recovery bundle handed to the browser. It contains the three scoped URLs and owner key; no room exists until you confirm creation." : "No room will be created until the full private recovery bundle is downloaded successfully.";
      const receipt = dialog.querySelector("[data-planr-share-result]");
      if (receipt) receipt.hidden = state.phase !== "created" || !state.result;
      const resultUrl = dialog.querySelector("[data-planr-share-url]");
      if (resultUrl) resultUrl.value = state.result?.url ?? "";
      const owner = dialog.querySelector("[data-planr-share-owner]");
      if (owner) owner.hidden = !state.result?.ownerUrl;
      const ownerUrl = dialog.querySelector("[data-planr-share-owner-url]");
      if (ownerUrl) ownerUrl.value = state.result?.ownerUrl ?? "";
      const manage = dialog.querySelector("[data-planr-share-manage]");
      if (manage) manage.hidden = !state.result?.manageUrl;
      const manageUrl = dialog.querySelector("[data-planr-share-manage-url]");
      if (manageUrl) manageUrl.value = state.result?.manageUrl ?? "";
      const deletion = dialog.querySelector("[data-planr-share-deletion]");
      if (deletion) deletion.hidden = !state.result?.deletionToken;
      const deletionToken = dialog.querySelector("[data-planr-share-deletion-token]");
      if (deletionToken) deletionToken.textContent = state.result?.deletionToken ?? "";
      const error = dialog.querySelector("[data-planr-share-error]");
      if (error) {
        error.hidden = !state.error;
        error.textContent = state.error;
      }
    }
    async function open() {
      clearPendingOwnerSigner();
      resetCopyButtons();
      if (!state.open) returnFocus = document2.activeElement instanceof window.HTMLElement ? document2.activeElement : trigger;
      state = reduceArtifactShareDialog(state, { type: "open" });
      state = reduceArtifactShareDialog(state, { type: "preview-start" });
      selectSupportedTransport();
      state = reduceArtifactShareDialog(state, { type: "preview-start" });
      render();
      dialog.querySelector("[data-planr-share-close]")?.focus();
      const request = ++generation;
      try {
        if (!capabilities.length) throw new ArtifactShareUiError("E_ARTIFACT_SHARE_HANDLER_REQUIRED", unavailable);
        const preview = await handlers.prepareShare(Object.freeze({
          review: reviewForShare(stageController),
          fragmentLimit: ARTIFACT_SHARE_FRAGMENT_LIMIT
        }));
        if (request !== generation || !state.open) return state;
        state = reduceArtifactShareDialog(state, { type: "preview-ready", preview });
        selectSupportedTransport();
        if (!supports(state.transport)) throw new ArtifactShareUiError("E_ARTIFACT_SHARE_TRANSPORT_UNAVAILABLE", "This review is too large for the sharing options supported by this viewer. Open it with an updated OpenPlanr installation or export the review.");
        render();
        announce2(capabilities.includes("fragment") && state.preview.fragmentEligible ? "Private fragment is available. Nothing will be uploaded." : "Review prepared. Choose an available sharing option.");
      } catch (error) {
        if (request !== generation || !state.open) return state;
        state = reduceArtifactShareDialog(state, { type: "failure", error: error?.message });
        render();
        announce2(state.error);
      }
      return state;
    }
    function close() {
      if (state.phase === "creating" || state.phase === "ambiguous") {
        announce2(state.phase === "ambiguous" ? "Room creation may have completed. Retry the exact attempt until its receipt is shown." : "Room creation is in progress. Keep this dialog open until its receipt is shown.");
        return state;
      }
      generation += 1;
      clearPendingOwnerSigner();
      state = reduceArtifactShareDialog(state, { type: "close" });
      resetCopyButtons();
      render();
      returnFocus?.focus?.();
      returnFocus = null;
      return state;
    }
    async function confirm() {
      if (!state.open || !supports(state.transport)) return state;
      if (!state.preview && state.phase === "error") return open();
      if (!state.preview || ["custody-preparing", "creating", "created"].includes(state.phase)) return state;
      const transport = state.transport;
      const request = generation;
      if (transport === "live" && !state.ownerCustodyEstablished) {
        state = reduceArtifactShareDialog(state, { type: "custody-start" });
        render();
        try {
          const custody = await establishArtifactOwnerCustody({
            prepareOwnerCustody: () => handlers.prepareOwnerCustody(Object.freeze({
              review: reviewForShare(stageController),
              ttl: state.ttl
            })),
            saveOwnerCustody: handlers.saveOwnerCustody
          });
          if (request !== generation || !state.open) return state;
          pendingOwnerCustody = custody;
          state = reduceArtifactShareDialog(state, { type: "custody-ready" });
          render();
          announce2("Private recovery-bundle download started. Verify the file is saved, then confirm room creation.");
        } catch (error) {
          if (request !== generation || !state.open) return state;
          clearPendingOwnerSigner();
          state = reduceArtifactShareDialog(state, {
            type: "failure",
            ownerCustodyEstablished: false,
            error: error?.message
          });
          render();
          announce2(state.error);
        }
        return state;
      }
      if (transport === "live" && !pendingOwnerCustody) {
        state = reduceArtifactShareDialog(state, {
          type: "failure",
          ownerCustodyEstablished: false,
          error: "The prepared recovery attempt is no longer available. Download a new bundle before creating a room."
        });
        render();
        announce2(state.error);
        return state;
      }
      state = reduceArtifactShareDialog(state, { type: "create-start" });
      render();
      try {
        const input = {
          review: reviewForShare(stageController),
          preview: state.preview,
          transport,
          ttl: ["live", "short"].includes(transport) ? state.ttl : void 0,
          confirmed: ["live", "short"].includes(transport)
        };
        if (transport === "live") {
          if (pendingOwnerCustody?.kind === "openplanr-live-room-preparation") {
            Object.defineProperty(input, "prepared", { enumerable: false, value: pendingOwnerCustody });
          } else {
            Object.defineProperty(input, "ownerSigner", { enumerable: false, value: pendingOwnerCustody });
          }
        }
        const result = await handlers.createShare(Object.freeze(input));
        if (request !== generation || !state.open) return state;
        if (transport === "live" && result?.ownerSigner !== pendingOwnerSigner()) {
          throw new ArtifactShareUiError(
            "E_ARTIFACT_SHARE_OWNER_CUSTODY_MISMATCH",
            "The created room did not bind the prepared owner key. Retry the exact prepared attempt.",
            { effect: "ambiguous" }
          );
        }
        state = reduceArtifactShareDialog(state, {
          type: "create-success",
          result: { ...result, transport }
        });
        clearPendingOwnerSigner();
        render();
        announce2(transport === "live" ? "Live room created. Keep the downloaded owner key with the separate owner-verdict URL; management cannot set a verdict." : transport === "short" ? "Encrypted short link copied. Store the one-time deletion token now." : "Private fragment copied. Nothing was uploaded.");
        try {
          await handlers.copyText(state.result.url);
          announce2(transport === "live" ? "Live review URL copied. Keep the downloaded owner key with the separate owner-verdict URL." : transport === "short" ? "Encrypted short link copied. Store the one-time deletion token now." : "Private fragment copied. Nothing was uploaded.");
        } catch {
          announce2(transport === "live" ? "Live room created. Copy the review and owner-verdict URLs manually; the room receipt remains visible." : "Share created. Copy the URL manually; the receipt remains visible.");
        }
      } catch (error) {
        if (request !== generation || !state.open) return state;
        const ambiguous = transport === "live" && error?.details?.effect === "ambiguous";
        if (transport === "live" && !ambiguous) clearPendingOwnerSigner();
        state = reduceArtifactShareDialog(state, {
          type: "failure",
          ambiguous,
          ownerCustodyEstablished: transport === "live" && Boolean(pendingOwnerCustody),
          error: error?.message
        });
        render();
        announce2(state.error);
      }
      return state;
    }
    async function copy(value, successMessage, button) {
      if (!value) return;
      try {
        await handlers.copyText(value);
        showCopyState(button, "copied");
        announce2(successMessage);
      } catch (error) {
        showCopyState(button, "error");
        announce2(error?.message ?? "The value could not be copied. The share receipt remains visible.");
      }
    }
    if (existingRoom) {
      const value = stableShareUrl();
      if (value) {
        const label = trigger.querySelector(".planr-action-label");
        if (label) label.textContent = "Copy link";
        else trigger.textContent = "Copy link";
        trigger.dataset.planrCopyLabel = "Copy link";
        trigger.dataset.planrTooltip = "Copy link";
        trigger.removeAttribute("aria-haspopup");
        trigger.setAttribute("aria-label", "Copy this live review room link");
        listen(trigger, "click", () => {
          void copyExistingRoom();
        });
      } else {
        trigger.hidden = true;
      }
    } else {
      listen(trigger, "click", open);
    }
    listen(backdrop, "click", (event) => {
      const button = event.target.closest?.("button");
      if (!button) return;
      if (button.dataset.planrShareClose !== void 0 || button.dataset.planrShareCancel !== void 0) {
        close();
        return;
      }
      if (button.dataset.planrShareTransport) {
        if (!supports(button.dataset.planrShareTransport)) return;
        if (["custody-ready", "creating", "ambiguous", "created"].includes(state.phase)) return;
        if (button.dataset.planrShareTransport !== state.transport) clearPendingOwnerSigner();
        state = reduceArtifactShareDialog(state, {
          type: "select-transport",
          transport: button.dataset.planrShareTransport
        });
        render();
        announce2(state.transport === "live" ? "Live encrypted review selected. Anyone with this link can comment." : state.transport === "short" ? "Encrypted short link selected. Creation requires confirmation." : "Private fragment selected. Nothing will be uploaded.");
        return;
      }
      if (button.dataset.planrShareConfirm !== void 0) {
        void confirm();
        return;
      }
      if (button.dataset.planrShareCopyUrl !== void 0) {
        void copy(state.result?.url, "Review URL copied.", button);
        return;
      }
      if (button.dataset.planrShareCopyOwner !== void 0) {
        void copy(
          state.result?.ownerUrl,
          "Private owner-verdict URL copied. It requires the matching downloaded owner key.",
          button
        );
        return;
      }
      if (button.dataset.planrShareCopyManage !== void 0) {
        void copy(
          state.result?.manageUrl,
          "Private management URL copied. It can pause, reopen, or delete the room, but cannot set a verdict.",
          button
        );
        return;
      }
      if (button.dataset.planrShareCopyDeletion !== void 0) {
        void copy(state.result?.deletionToken, "One-time deletion token copied.", button);
      }
    });
    const ttlSelect = dialog.querySelector("[data-planr-share-ttl]");
    if (ttlSelect) listen(ttlSelect, "change", () => {
      if (["custody-ready", "creating", "ambiguous", "created"].includes(state.phase)) {
        ttlSelect.value = state.ttl;
        return;
      }
      state = reduceArtifactShareDialog(state, { type: "set-ttl", ttl: ttlSelect.value });
      render();
      announce2(`Expiry set to ${ARTIFACT_SHARE_TTLS[state.ttl].label}.`);
    });
    listen(document2, "keydown", (event) => {
      if (!state.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document2.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document2.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }, true);
    render();
    const controller = Object.freeze({
      getState: () => state,
      open,
      close,
      confirm,
      dispatch(action) {
        if (action.type === "select-transport" && !supports(action.transport)) return state;
        state = reduceArtifactShareDialog(state, action);
        render();
        return state;
      },
      destroy() {
        if (state.phase === "creating" || state.phase === "ambiguous") {
          announce2(state.phase === "ambiguous" ? "Room creation may have completed. Retry the exact attempt until its receipt is shown." : "Room creation is in progress. Keep this review open until its receipt is shown.");
          return false;
        }
        generation += 1;
        clearPendingOwnerSigner();
        for (const timer of copyResetTimers.values()) window.clearTimeout(timer);
        copyResetTimers.clear();
        for (const remove of cleanup.splice(0)) remove();
        if (state.open) {
          state = reduceArtifactShareDialog(state, { type: "close" });
          render();
        }
        return true;
      }
    });
    window.__openPlanrArtifactShare = controller;
    return controller;
  }

  // lib/artifact/ui/hosted-viewer.mjs
  var HOSTED_ARTIFACT_VIEWER_STATES = Object.freeze([
    "idle",
    "empty-hash",
    "loading",
    "ready",
    "invalid-version",
    "malformed-payload",
    "too-large",
    "paste-missing",
    "expired",
    "decryption-failed",
    "unsupported-browser",
    "network-error",
    "room-closed"
  ]);
  var HOSTED_ARTIFACT_STATE_COPY = Object.freeze({
    "empty-hash": Object.freeze({
      title: "Open a private review link",
      detail: "This page needs a complete OpenPlanr fragment or encrypted short-link URL.",
      action: ""
    }),
    loading: Object.freeze({
      title: "Loading private review",
      detail: "Validating the immutable payload before opening the artifact.",
      action: ""
    }),
    "invalid-version": Object.freeze({
      title: "This review version is not supported",
      detail: "Ask the sender to create a new link with a compatible OpenPlanr release.",
      action: ""
    }),
    "malformed-payload": Object.freeze({
      title: "This review link is incomplete",
      detail: "Copy the complete URL again, including everything after the # character.",
      action: ""
    }),
    "too-large": Object.freeze({
      title: "This private fragment is too large",
      detail: "Ask the sender to create an encrypted expiring short link instead.",
      action: ""
    }),
    "paste-missing": Object.freeze({
      title: "This encrypted review is unavailable",
      detail: "It may have been deleted. Ask the sender for a new immutable review link.",
      action: ""
    }),
    expired: Object.freeze({
      title: "This encrypted review expired",
      detail: "Ask the sender for a new immutable review link.",
      action: ""
    }),
    "decryption-failed": Object.freeze({
      title: "This key cannot decrypt the review",
      detail: "Use the complete link, including its private fragment key. The payload may also have been changed.",
      action: ""
    }),
    "unsupported-browser": Object.freeze({
      title: "Browser support is required",
      detail: "Use a current browser with raw DEFLATE and Web Crypto support.",
      action: ""
    }),
    "network-error": Object.freeze({
      title: "The encrypted review could not be loaded",
      detail: "Your link remains unchanged. Check the connection and try again safely.",
      action: "Try again"
    }),
    "room-closed": Object.freeze({
      title: "Comments are paused",
      detail: "This review remains available to read, but the owner has paused new feedback.",
      action: ""
    })
  });
  var HostedArtifactViewerError = class extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "HostedArtifactViewerError";
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  };
  function freezeState2(value) {
    const status = HOSTED_ARTIFACT_VIEWER_STATES.includes(value.status) ? value.status : "idle";
    return Object.freeze({
      status,
      transport: ["fragment", "short", "room"].includes(value.transport) ? value.transport : null,
      request: value.request ? Object.freeze({ ...value.request }) : null,
      envelope: value.envelope ?? null,
      retryable: status === "network-error"
    });
  }
  function locationParts(location) {
    if (typeof location === "string") {
      const parsed = new URL(location, "https://share.openplanr.dev/");
      return { pathname: parsed.pathname, hash: parsed.hash };
    }
    return {
      pathname: typeof location?.pathname === "string" ? location.pathname : "/",
      hash: typeof location?.hash === "string" ? location.hash : ""
    };
  }
  function malformed(status, details = {}) {
    return Object.freeze({ ok: false, status, details: Object.freeze(details) });
  }
  function parseHostedArtifactLocation(location, {
    fragmentLimit = ARTIFACT_SHARE_FRAGMENT_LIMIT
  } = {}) {
    const { pathname, hash } = locationParts(location);
    const shortMatch = pathname.match(/^\/p\/([A-Za-z0-9_-]{1,128})\/?$/);
    if (shortMatch) {
      if (!hash.startsWith("#k=")) return malformed("malformed-payload", { transport: "short" });
      const key = hash.slice(3);
      if (!/^[A-Za-z0-9_-]{43}$/.test(key)) {
        return malformed("malformed-payload", { transport: "short" });
      }
      return Object.freeze({
        ok: true,
        transport: "short",
        id: shortMatch[1],
        key
      });
    }
    const roomMatch = pathname.match(/^\/r\/([A-Za-z0-9_-]{16,128})\/?$/);
    if (roomMatch) {
      const params = new URLSearchParams(hash.slice(1));
      const key = params.get("k");
      const write = params.get("w");
      const owner = params.get("o");
      const manage = params.get("m");
      const authority = [write, owner, manage].filter(Boolean);
      if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key) || authority.length > 1 || write && !/^[A-Za-z0-9_-]{43}$/.test(write) || owner && !/^[A-Za-z0-9_-]{43}$/.test(owner) || manage && !/^[A-Za-z0-9_-]{43}$/.test(manage)) {
        return malformed("malformed-payload", { transport: "room" });
      }
      return Object.freeze({ ok: true, transport: "room", id: roomMatch[1], key, ...write ? { write } : {}, ...owner ? { owner } : {}, ...manage ? { manage } : {} });
    }
    if (!hash || hash === "#") return malformed("empty-hash");
    const fragment = hash.slice(1);
    if (fragment.length > fragmentLimit) {
      return malformed("too-large", { fragmentLength: fragment.length, fragmentLimit });
    }
    if (!fragment.startsWith("v1.")) {
      return malformed(/^v\d+\./.test(fragment) ? "invalid-version" : "malformed-payload");
    }
    const payload = fragment.slice(3);
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return malformed("malformed-payload");
    return Object.freeze({ ok: true, transport: "fragment", version: "v1", payload });
  }
  function hostedArtifactStateForError(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    if (["E_ARTIFACT_BROWSER_UNSUPPORTED", "E_ARTIFACT_CODEC_UNSUPPORTED"].includes(code)) {
      return "unsupported-browser";
    }
    if (["E_ARTIFACT_FRAGMENT_TOO_LARGE", "E_ARTIFACT_PAYLOAD_TOO_LARGE", "E_ARTIFACT_DECOMPRESSION_LIMIT"].includes(code)) {
      return "too-large";
    }
    if (["E_ARTIFACT_PASTE_NOT_FOUND", "E_ARTIFACT_SHARE_NOT_FOUND", "E_ARTIFACT_PASTE_UNAVAILABLE"].includes(code)) {
      return "paste-missing";
    }
    if (["E_ARTIFACT_PASTE_EXPIRED", "E_ARTIFACT_SHARE_EXPIRED"].includes(code)) {
      return "expired";
    }
    if (["E_ARTIFACT_DECRYPTION_FAILED", "E_ARTIFACT_AUTH_FAILED", "E_ARTIFACT_PAYLOAD_TAMPERED", "OperationError"].includes(code)) {
      return "decryption-failed";
    }
    if (["E_ARTIFACT_SHARE_NETWORK", "E_ARTIFACT_NETWORK", "E_ARTIFACT_FETCH_FAILED"].includes(code) || error?.name === "TypeError") {
      return "network-error";
    }
    if (["E_ARTIFACT_VERSION_UNSUPPORTED", "E_ARTIFACT_FRAGMENT_VERSION", "E_ARTIFACT_FRAGMENT_VERSION_UNSUPPORTED"].includes(code)) {
      return "invalid-version";
    }
    if (code === "E_ARTIFACT_PASTE_INVALID") return "malformed-payload";
    return "malformed-payload";
  }
  function setCopy(document2, status) {
    const copy = HOSTED_ARTIFACT_STATE_COPY[status] ?? { title: "", detail: "", action: "" };
    const title = document2.querySelector("[data-planr-hosted-title]");
    const detail = document2.querySelector("[data-planr-hosted-detail]");
    const action = document2.querySelector("[data-planr-hosted-retry]");
    if (title) title.textContent = copy.title;
    if (detail) detail.textContent = copy.detail;
    if (action) {
      action.textContent = copy.action;
      action.hidden = !copy.action;
    }
  }
  function mountHostedArtifactViewer({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    enabled = false,
    location = window?.location,
    decodeFragment,
    loadShort,
    loadRoom,
    onEnvelope,
    supportsTransport = () => true,
    fragmentLimit = ARTIFACT_SHARE_FRAGMENT_LIMIT
  } = {}) {
    if (!enabled || !document2 || !window) return null;
    const slot = document2.querySelector("[data-planr-hosted-viewer]");
    if (!slot) return null;
    let state = freezeState2({ status: "idle" });
    let generation = 0;
    const cleanup = [];
    function render() {
      const visible = !["idle", "ready"].includes(state.status);
      slot.hidden = !visible;
      slot.dataset.planrHostedState = state.status;
      slot.setAttribute("aria-busy", String(state.status === "loading"));
      setCopy(document2, state.status);
    }
    function setState(next) {
      state = freezeState2(next);
      render();
      return state;
    }
    async function load() {
      const parsed = parseHostedArtifactLocation(location, { fragmentLimit });
      if (!parsed.ok) return setState({ status: parsed.status });
      const request = parsed.transport === "fragment" ? { transport: "fragment", version: parsed.version, payload: parsed.payload } : { transport: parsed.transport, id: parsed.id, key: parsed.key, ...parsed.write ? { write: parsed.write } : {}, ...parsed.owner ? { owner: parsed.owner } : {}, ...parsed.manage ? { manage: parsed.manage } : {} };
      if (!supportsTransport(parsed.transport)) {
        return setState({ status: "unsupported-browser", transport: parsed.transport, request });
      }
      const sequence = ++generation;
      setState({ status: "loading", transport: parsed.transport, request });
      try {
        const envelope = parsed.transport === "fragment" ? await (typeof decodeFragment === "function" ? decodeFragment(Object.freeze({ version: parsed.version, payload: parsed.payload })) : Promise.reject(new HostedArtifactViewerError(
          "E_ARTIFACT_CODEC_UNSUPPORTED",
          "No private-fragment decoder is installed."
        ))) : parsed.transport === "short" ? await (typeof loadShort === "function" ? loadShort(Object.freeze({ id: parsed.id, key: parsed.key })) : Promise.reject(new HostedArtifactViewerError(
          "E_ARTIFACT_BROWSER_UNSUPPORTED",
          "No encrypted short-link loader is installed."
        ))) : await (typeof loadRoom === "function" ? loadRoom(Object.freeze({ id: parsed.id, key: parsed.key, ...parsed.write ? { write: parsed.write } : {}, ...parsed.owner ? { owner: parsed.owner } : {}, ...parsed.manage ? { manage: parsed.manage } : {} })) : Promise.reject(new HostedArtifactViewerError("E_ARTIFACT_BROWSER_UNSUPPORTED", "No live review room loader is installed.")));
        if (sequence !== generation) return state;
        setState({ status: "ready", transport: parsed.transport, request, envelope });
        if (typeof onEnvelope === "function") await onEnvelope(envelope, Object.freeze({ transport: parsed.transport }));
      } catch (error) {
        if (sequence !== generation) return state;
        setState({ status: hostedArtifactStateForError(error), transport: parsed.transport, request });
      }
      return state;
    }
    function onClick(event) {
      if (!event.target.closest?.("[data-planr-hosted-retry]") || !state.retryable) return;
      void load();
    }
    slot.addEventListener("click", onClick);
    cleanup.push(() => slot.removeEventListener("click", onClick));
    render();
    const ready = load();
    const controller = Object.freeze({
      getState: () => state,
      ready,
      retry() {
        return state.retryable ? load() : Promise.resolve(state);
      },
      load,
      destroy() {
        generation += 1;
        for (const remove of cleanup.splice(0)) remove();
      }
    });
    window.__openPlanrHostedArtifactViewer = controller;
    return controller;
  }

  // lib/artifact/ui/stage-payload.mjs
  var PRESENTATIONS = Object.freeze(["document", "canvas"]);
  function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
  function freezeArtifactMetadata(artifact, index) {
    if (!artifact || typeof artifact !== "object") {
      throw new TypeError(`Artifact ${index + 1} must be an object.`);
    }
    if (typeof artifact.id !== "string" || artifact.id.length === 0) {
      throw new TypeError(`Artifact ${index + 1} requires an id.`);
    }
    return Object.freeze({
      id: artifact.id,
      title: typeof artifact.title === "string" && artifact.title.length > 0 ? artifact.title : `Artifact ${index + 1}`,
      sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : "",
      viewport: Object.freeze({
        width: positiveInteger(artifact.viewport?.width, 1440),
        height: positiveInteger(artifact.viewport?.height, 900)
      }),
      colorScheme: ["light", "dark"].includes(artifact.colorScheme) ? artifact.colorScheme : "light"
    });
  }
  function requestedArtifactId(value) {
    if (typeof value === "string") return value;
    return typeof value?.id === "string" ? value.id : "";
  }
  function availableId(artifacts, requested, fallback = "") {
    return artifacts.some(({ id }) => id === requested) ? requested : fallback;
  }
  function normalizeViewMode(value, artifactCount) {
    if (artifactCount < 2) return "single";
    return ["single", "variants", "split"].includes(value) ? value : "variants";
  }
  function createArtifactStagePayload(envelope = {}, { viewer } = {}) {
    const artifacts = Object.freeze(
      (Array.isArray(envelope?.artifacts) ? envelope.artifacts : []).map(freezeArtifactMetadata)
    );
    const sourceViewer = viewer && typeof viewer === "object" ? viewer : envelope?.viewer && typeof envelope.viewer === "object" ? envelope.viewer : {};
    const firstId = artifacts[0]?.id ?? "";
    const activeArtifactId = availableId(
      artifacts,
      requestedArtifactId(sourceViewer.activeArtifactId),
      firstId
    );
    const mode = normalizeViewMode(sourceViewer.mode, artifacts.length);
    return Object.freeze({
      schemaVersion: "1.0.0",
      artifacts,
      viewer: Object.freeze({
        mode,
        activeArtifactId,
        ...PRESENTATIONS.includes(sourceViewer.presentation) ? { presentation: sourceViewer.presentation } : {}
      })
    });
  }

  // lib/artifact/ui/stage.mjs
  var ARTIFACT_STAGE_EVENTS = Object.freeze({
    change: "planr:stage-change",
    point: "planr:artifact-point",
    region: "planr:artifact-region",
    layout: "planr:artifact-layout"
  });
  var ARTIFACT_STAGE_LIMITS = Object.freeze({
    defaultZoom: 72,
    minZoom: 25,
    maxZoom: 200,
    zoomStep: 10,
    maxDocumentWidth: 16384,
    maxDocumentHeight: 262144
  });
  var VIEW_MODES = Object.freeze(["single", "variants", "split"]);
  var REVIEW_MODES = Object.freeze(["interact", "comment"]);
  var THEMES = Object.freeze(["auto", "light", "dark"]);
  var PRESENTATIONS2 = Object.freeze(["document", "canvas"]);
  var STATUSES = Object.freeze([
    "ready",
    "empty",
    "bundling",
    "loading",
    "invalid",
    "expired",
    "decryption-failed",
    "unsupported-browser"
  ]);
  var STATUS_COPY = Object.freeze({
    empty: Object.freeze({
      title: "No artifact content",
      detail: "Choose a bundled HTML artifact to begin this review."
    }),
    bundling: Object.freeze({
      title: "Bundling artifact",
      detail: "Packaging local scripts, styles, fonts, and images without network access."
    }),
    loading: Object.freeze({
      title: "Loading private review",
      detail: "Validating the envelope and frozen artifact viewport."
    }),
    invalid: Object.freeze({
      title: "This review is invalid",
      detail: "The artifact envelope could not be decoded or validated."
    }),
    expired: Object.freeze({
      title: "This encrypted review expired",
      detail: "Ask the sender for a new immutable review link."
    }),
    "decryption-failed": Object.freeze({
      title: "This key cannot decrypt the review",
      detail: "Use the complete link, including its private fragment key."
    }),
    "unsupported-browser": Object.freeze({
      title: "Browser support is required",
      detail: "Use a current browser with Blob URL support to review this artifact."
    })
  });
  function member2(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }
  function finite2(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function clamp2(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function normalized2(value) {
    return Math.round(clamp2(finite2(value), 0, 1) * 1e6) / 1e6;
  }
  function artifactMetadata(artifact) {
    return Object.freeze({
      id: artifact.id,
      title: artifact.title,
      sha256: artifact.sha256,
      viewport: artifact.viewport,
      colorScheme: artifact.colorScheme
    });
  }
  function requestedArtifactId2(value) {
    if (typeof value === "string") return value;
    return typeof value?.id === "string" ? value.id : "";
  }
  function availableId2(artifacts, requested, fallback = "") {
    return artifacts.some(({ id }) => id === requested) ? requested : fallback;
  }
  function comparisonIdFor(artifacts, activeArtifactId, requested = "") {
    if (requested !== activeArtifactId && artifacts.some(({ id }) => id === requested)) return requested;
    return artifacts.find(({ id }) => id !== activeArtifactId)?.id ?? "";
  }
  function normalizeViewMode2(value, artifactCount) {
    if (artifactCount < 2) return "single";
    return member2(value, VIEW_MODES, "variants");
  }
  function resolveArtifactPresentation(value, { viewMode = "single", artifactCount = 1 } = {}) {
    if (PRESENTATIONS2.includes(value)) return value;
    return artifactCount > 1 || viewMode === "variants" || viewMode === "split" ? "canvas" : "document";
  }
  function createArtifactStageState(payload = {}, shellModel = {}) {
    const artifacts = Object.freeze(
      (Array.isArray(payload?.artifacts) ? payload.artifacts : []).map(artifactMetadata)
    );
    const firstId = artifacts[0]?.id ?? "";
    const activeArtifactId = availableId2(
      artifacts,
      requestedArtifactId2(shellModel.activeArtifact ?? shellModel.activeArtifactId) || requestedArtifactId2(payload?.viewer?.activeArtifactId),
      firstId
    );
    const comparisonArtifactId = comparisonIdFor(
      artifacts,
      activeArtifactId,
      requestedArtifactId2(shellModel.comparisonArtifact ?? shellModel.comparisonArtifactId)
    );
    const statusFallback = artifacts.length === 0 ? "empty" : "ready";
    let status = member2(shellModel.status, STATUSES, statusFallback);
    if (artifacts.length === 0 && status === "ready") status = "empty";
    const viewMode = normalizeViewMode2(
      shellModel.viewMode ?? payload?.viewer?.mode,
      artifacts.length
    );
    const presentation = resolveArtifactPresentation(
      shellModel.presentation ?? payload?.viewer?.presentation,
      { viewMode, artifactCount: artifacts.length }
    );
    return Object.freeze({
      schemaVersion: "1.0.0",
      artifacts,
      activeArtifactId,
      comparisonArtifactId,
      viewMode,
      presentation,
      reviewMode: member2(shellModel.reviewMode, REVIEW_MODES, "interact"),
      zoom: clamp2(
        Number.isInteger(shellModel.zoom) ? shellModel.zoom : ARTIFACT_STAGE_LIMITS.defaultZoom,
        ARTIFACT_STAGE_LIMITS.minZoom,
        ARTIFACT_STAGE_LIMITS.maxZoom
      ),
      railOpen: shellModel.railOpen === void 0 ? presentation === "canvas" : Boolean(shellModel.railOpen),
      theme: member2(shellModel.theme, THEMES, "auto"),
      status
    });
  }
  function nextState(state, changes) {
    return Object.freeze({ ...state, ...changes });
  }
  function reduceArtifactStageState(state, action = {}) {
    switch (action.type) {
      case "set-active": {
        const id = availableId2(state.artifacts, action.artifactId);
        if (!id || id === state.activeArtifactId) return state;
        const comparisonArtifactId = id === state.comparisonArtifactId ? state.activeArtifactId : comparisonIdFor(state.artifacts, id, state.comparisonArtifactId);
        return nextState(state, { activeArtifactId: id, comparisonArtifactId });
      }
      case "set-comparison": {
        const id = comparisonIdFor(state.artifacts, state.activeArtifactId, action.artifactId);
        return id === state.comparisonArtifactId ? state : nextState(state, { comparisonArtifactId: id });
      }
      case "set-view-mode": {
        const viewMode = normalizeViewMode2(action.viewMode, state.artifacts.length);
        return viewMode === state.viewMode ? state : nextState(state, { viewMode });
      }
      case "set-review-mode": {
        const reviewMode = member2(action.reviewMode, REVIEW_MODES, state.reviewMode);
        return reviewMode === state.reviewMode ? state : nextState(state, { reviewMode });
      }
      case "set-zoom": {
        const zoom = clamp2(
          Math.round(finite2(action.zoom, state.zoom)),
          ARTIFACT_STAGE_LIMITS.minZoom,
          ARTIFACT_STAGE_LIMITS.maxZoom
        );
        return zoom === state.zoom ? state : nextState(state, { zoom });
      }
      case "zoom-by":
        return reduceArtifactStageState(state, {
          type: "set-zoom",
          zoom: state.zoom + finite2(action.delta)
        });
      case "set-rail-open": {
        const railOpen = Boolean(action.railOpen);
        return railOpen === state.railOpen ? state : nextState(state, { railOpen });
      }
      case "toggle-rail":
        return nextState(state, { railOpen: !state.railOpen });
      case "set-theme": {
        const theme = member2(action.theme, THEMES, state.theme);
        return theme === state.theme ? state : nextState(state, { theme });
      }
      case "cycle-theme": {
        const index = THEMES.indexOf(state.theme);
        return nextState(state, { theme: THEMES[(index + 1) % THEMES.length] });
      }
      case "set-status": {
        const status = member2(action.status, STATUSES, state.status);
        return status === state.status ? state : nextState(state, { status });
      }
      default:
        return state;
    }
  }
  function visibleArtifactIds(state) {
    if (!state.activeArtifactId) return Object.freeze([]);
    if (state.viewMode === "split" && state.comparisonArtifactId) {
      return Object.freeze([state.activeArtifactId, state.comparisonArtifactId]);
    }
    return Object.freeze([state.activeArtifactId]);
  }
  function assertRect2(rect) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      throw new RangeError("Artifact bounds must have positive finite dimensions.");
    }
  }
  function clientPointToNormalized(rect, point) {
    assertRect2(rect);
    return Object.freeze({
      x: normalized2((finite2(point?.x ?? point?.clientX) - rect.left) / rect.width),
      y: normalized2((finite2(point?.y ?? point?.clientY) - rect.top) / rect.height)
    });
  }
  function normalizedPointToClient(rect, point) {
    assertRect2(rect);
    return Object.freeze({
      x: rect.left + normalized2(point?.x) * rect.width,
      y: rect.top + normalized2(point?.y) * rect.height
    });
  }
  function parseDataScript(document2, id) {
    const node = document2.getElementById(id);
    if (!node) throw new Error(`Missing artifact shell data: ${id}`);
    return JSON.parse(node.textContent ?? "null");
  }
  function isEditableTarget(target) {
    const HTMLElement = target?.ownerDocument?.defaultView?.HTMLElement;
    return Boolean(HTMLElement && target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)));
  }
  function stageArtifactById(state, id) {
    return state.artifacts.find((artifact) => artifact.id === id) ?? null;
  }
  function updateStatus(document2, state) {
    const statusPanel = document2.querySelector(".planr-stage-status");
    const surface = document2.querySelector(".planr-stage-surface");
    if (!statusPanel || !surface) return;
    const ready = state.status === "ready";
    statusPanel.hidden = ready;
    surface.toggleAttribute("inert", !ready);
    surface.setAttribute("aria-hidden", String(!ready));
    if (ready) surface.removeAttribute("aria-hidden");
    const copy = STATUS_COPY[state.status];
    if (copy) {
      const title = statusPanel.querySelector("strong");
      const detail = statusPanel.querySelector("p");
      if (title) title.textContent = copy.title;
      if (detail) detail.textContent = copy.detail;
    }
  }
  function emit(root, window, type, detail) {
    root.dispatchEvent(new window.CustomEvent(type, { detail, bubbles: true }));
  }
  async function htmlForSource(window, source) {
    if (typeof source === "string" && source.trimStart().startsWith("<")) return source;
    if (source && typeof source === "object" && typeof source.html === "string") return source.html;
    if (source instanceof window.Blob) return source.text();
    if (source instanceof window.ArrayBuffer) return new window.TextDecoder().decode(source);
    if (window.ArrayBuffer.isView(source)) {
      return new window.TextDecoder().decode(
        new window.Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      );
    }
    return null;
  }
  function mountArtifactStage({
    document: document2 = globalThis.document,
    window = document2?.defaultView,
    resolveArtifactSource,
    sourceTransport = "blob",
    bridgeClient,
    onState,
    review: reviewOptions = {},
    share: shareOptions = {},
    hosted: hostedOptions = {}
  } = {}) {
    if (!document2 || !window) return null;
    const root = document2.querySelector(".planr-shell");
    if (!root) return null;
    if (!["blob", "srcdoc"].includes(sourceTransport)) {
      throw new TypeError("Artifact source transport must be blob or srcdoc.");
    }
    let payload;
    let shellModel;
    let reviewConfig;
    try {
      payload = parseDataScript(document2, "planr-artifact-stage-payload");
      shellModel = parseDataScript(document2, "planr-artifact-shell-model");
      reviewConfig = parseDataScript(document2, "planr-artifact-review-state");
    } catch {
      payload = { artifacts: [], viewer: { mode: "single", activeArtifactId: "" } };
      shellModel = { status: "invalid" };
      reviewConfig = { reviewOf: "0".repeat(64), review: null };
    }
    let state;
    try {
      state = createArtifactStageState(payload, shellModel);
    } catch {
      state = createArtifactStageState({}, { status: "invalid" });
    }
    const frames = new Map(
      [...document2.querySelectorAll("[data-planr-artifact-frame]")].map((frame) => [frame.dataset.planrArtifactFrame, frame])
    );
    const panels = new Map(
      [...document2.querySelectorAll(".planr-artifact-panel[data-artifact-id]")].map((panel) => [panel.dataset.artifactId, panel])
    );
    const documentLayouts = /* @__PURE__ */ new Map();
    const cleanup = [];
    const frameBudget = root.dataset.planrFrameBudget === "3" ? 3 : null;
    const frameLoads = /* @__PURE__ */ new Map();
    let frameUse = 0;
    let frameQueue = Promise.resolve();
    let disposed = false;
    for (const frame of frames.values()) frame.dataset.planrFrameState = "unloaded";
    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    }
    function render({ announce: announce2 = false } = {}) {
      const visible = new Set(visibleArtifactIds(state));
      root.dataset.planrView = state.viewMode;
      root.dataset.planrReviewMode = state.reviewMode;
      root.dataset.planrState = state.status;
      root.dataset.planrRailOpen = String(state.railOpen);
      root.dataset.planrPresentation = state.presentation;
      document2.documentElement.dataset.planrPresentation = state.presentation;
      document2.documentElement.dataset.planrTheme = state.theme;
      const grid = document2.querySelector(".planr-frame-grid");
      const surface = document2.querySelector(".planr-stage-surface");
      const tablist = document2.querySelector(".planr-variants");
      const rail = document2.getElementById("planr-review-rail");
      const feedbackButton = document2.querySelector('[data-planr-action="feedback"]');
      const addCommentButton = document2.querySelector('[data-planr-action="add-comment"]');
      const themeButton = document2.querySelector('[data-planr-action="theme"]');
      const statusSlot = document2.querySelector('[data-planr-slot="status"]');
      const metadata = document2.querySelector(".planr-title-block > span");
      const breadcrumb = document2.querySelector(".planr-stage-heading > span:first-child");
      const activeArtifact = stageArtifactById(state, state.activeArtifactId);
      if (grid) grid.dataset.planrLayout = state.viewMode;
      const visualOrder = state.viewMode === "split" ? [...visible, ...state.artifacts.map(({ id }) => id).filter((id) => !visible.has(id))] : state.artifacts.map(({ id }) => id);
      if (surface) surface.style.setProperty("--planr-shell-zoom", String(state.zoom / 100));
      if (tablist) tablist.hidden = state.viewMode === "single" || state.artifacts.length < 2;
      if (rail) {
        rail.toggleAttribute("inert", !state.railOpen);
        rail.setAttribute("aria-hidden", String(!state.railOpen));
        if (state.railOpen) rail.removeAttribute("aria-hidden");
      }
      if (feedbackButton) feedbackButton.setAttribute("aria-expanded", String(state.railOpen));
      if (addCommentButton) {
        const paused = root.hasAttribute("data-planr-room-comments-paused");
        addCommentButton.disabled = paused;
        addCommentButton.setAttribute("aria-pressed", String(state.reviewMode === "comment"));
        addCommentButton.setAttribute(
          "aria-label",
          paused ? "Add comment unavailable: comments are paused" : "Add comment"
        );
        addCommentButton.dataset.planrTooltip = paused ? "Comments are paused" : "Add comment (C)";
      }
      if (themeButton) {
        themeButton.textContent = state.theme;
        themeButton.setAttribute("aria-label", `Shell theme ${state.theme}`);
      }
      if (statusSlot) statusSlot.textContent = state.reviewMode === "comment" ? "Comment mode" : "Interactions enabled";
      if (metadata && activeArtifact) {
        metadata.textContent = `HTML · ${activeArtifact.viewport.width}×${activeArtifact.viewport.height}`;
      }
      if (breadcrumb) breadcrumb.textContent = `ARTIFACT / ${(activeArtifact?.title ?? "Artifact").toUpperCase()}`;
      for (const button of document2.querySelectorAll("[data-planr-view]")) {
        const mode = button.dataset.planrView;
        button.setAttribute("aria-pressed", String(mode === state.viewMode));
        button.disabled = state.artifacts.length < 2 && mode !== "single";
      }
      for (const button of document2.querySelectorAll("[data-planr-mode]")) {
        button.setAttribute("aria-pressed", String(button.dataset.planrMode === state.reviewMode));
      }
      for (const button of document2.querySelectorAll('[data-planr-action="zoom-reset"]')) {
        button.textContent = `${state.zoom}%`;
      }
      for (const tab of document2.querySelectorAll('[role="tab"][data-artifact-id]')) {
        const selected = tab.dataset.artifactId === state.activeArtifactId;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      for (const [id, panel] of panels) {
        const isVisible = visible.has(id);
        const isPrimary = id === state.activeArtifactId;
        panel.hidden = !isVisible;
        panel.style.order = String(visualOrder.indexOf(id));
        const artifact = stageArtifactById(state, id);
        panel.setAttribute("aria-label", `${isPrimary ? "Primary" : "Comparison"} artifact: ${artifact?.title ?? id}`);
        const frame = frames.get(id);
        const frameReady = frameBudget === null || frame?.dataset.planrFrameState === "ready";
        const annotationLayer = panel.querySelector("[data-planr-annotation-layer]");
        if (frame) {
          frame.tabIndex = isVisible && frameReady && state.status === "ready" && state.reviewMode === "interact" ? 0 : -1;
          if (state.presentation === "document") {
            frame.setAttribute("scrolling", "no");
            frame.style.overflow = "hidden";
          } else {
            frame.removeAttribute("scrolling");
            frame.style.removeProperty("overflow");
          }
        }
        if (annotationLayer) {
          const enabled = isVisible && frameReady && state.status === "ready" && state.reviewMode === "comment";
          const hasComposer = Boolean(annotationLayer.querySelector("[data-planr-annotation-composer]"));
          annotationLayer.tabIndex = enabled ? 0 : -1;
          annotationLayer.setAttribute("aria-disabled", String(!enabled && !hasComposer));
        }
      }
      updateStatus(document2, state);
      if (typeof onState === "function") {
        try {
          onState(state);
        } catch {
        }
      }
      if (announce2) emit(root, window, ARTIFACT_STAGE_EVENTS.change, state);
    }
    function dispatch(action, { announce: announce2 = true } = {}) {
      const previous = state;
      state = reduceArtifactStageState(state, action);
      if (state !== previous) render({ announce: announce2 });
      return state;
    }
    function setActiveFromTab(tab, { focus = false } = {}) {
      dispatch({ type: "set-active", artifactId: tab.dataset.artifactId });
      if (focus) tab.focus();
    }
    function onClick(event) {
      const target = event.target.closest?.("button");
      if (!target) return;
      if (target.hasAttribute("data-planr-close-feedback")) {
        dispatch({ type: "set-rail-open", railOpen: false });
        document2.querySelector('[data-planr-action="feedback"]')?.focus();
        return;
      }
      if (target.dataset.planrView) {
        dispatch({ type: "set-view-mode", viewMode: target.dataset.planrView });
        return;
      }
      if (target.dataset.artifactId && target.getAttribute("role") === "tab") {
        setActiveFromTab(target);
        return;
      }
      if (target.dataset.planrMode) {
        dispatch({ type: "set-review-mode", reviewMode: target.dataset.planrMode });
        return;
      }
      switch (target.dataset.planrAction) {
        case "add-comment":
          if (!root.hasAttribute("data-planr-room-comments-paused")) {
            dispatch({ type: "set-review-mode", reviewMode: "comment" });
          }
          break;
        case "zoom-out":
          dispatch({ type: "zoom-by", delta: -ARTIFACT_STAGE_LIMITS.zoomStep });
          break;
        case "zoom-reset":
          dispatch({ type: "set-zoom", zoom: ARTIFACT_STAGE_LIMITS.defaultZoom });
          break;
        case "zoom-in":
          dispatch({ type: "zoom-by", delta: ARTIFACT_STAGE_LIMITS.zoomStep });
          break;
        case "feedback": {
          const rail = document2.getElementById("planr-review-rail");
          if (state.railOpen && rail?.contains(document2.activeElement)) target.focus();
          dispatch({ type: "toggle-rail" });
          break;
        }
        case "more": {
          const menu = target.closest(".planr-more")?.querySelector(".planr-more-menu");
          if (!menu) break;
          const open = menu.hidden;
          menu.hidden = !open;
          target.setAttribute("aria-expanded", String(open));
          if (open) menu.querySelector('[role="menuitem"]')?.focus();
          break;
        }
        case "sharing-options":
          target.closest(".planr-more-menu").hidden = true;
          document2.querySelector('[data-planr-action="more"]')?.setAttribute("aria-expanded", "false");
          shareController?.open?.();
          break;
        case "theme":
          dispatch({ type: "cycle-theme" });
          break;
        default:
          break;
      }
    }
    function onKeyDown(event) {
      if (event.defaultPrevented) return;
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !isEditableTarget(event.target)) {
        if (event.key.toLowerCase() === "i") {
          dispatch({ type: "set-review-mode", reviewMode: "interact" });
          return;
        }
        if (event.key.toLowerCase() === "c") {
          if (!root.hasAttribute("data-planr-room-comments-paused")) {
            dispatch({ type: "set-review-mode", reviewMode: "comment" });
            document2.querySelector('[data-planr-action="add-comment"]')?.focus();
          }
          return;
        }
        if (event.key === "Escape") {
          const more = document2.querySelector(".planr-more-menu:not([hidden])");
          if (more) {
            more.hidden = true;
            const trigger = document2.querySelector('[data-planr-action="more"]');
            trigger?.setAttribute("aria-expanded", "false");
            trigger?.focus();
            return;
          }
          if (state.presentation === "document" && state.reviewMode === "comment") {
            dispatch({ type: "set-review-mode", reviewMode: "interact" });
            document2.querySelector('[data-planr-action="add-comment"]')?.focus();
            return;
          }
          if (state.railOpen) {
            dispatch({ type: "set-rail-open", railOpen: false });
            document2.querySelector('[data-planr-action="feedback"]')?.focus();
            return;
          }
        }
      }
      const tab = event.target.closest?.('[role="tab"][data-artifact-id]');
      if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...document2.querySelectorAll('[role="tab"][data-artifact-id]')];
      const index = tabs.indexOf(tab);
      if (index < 0) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      setActiveFromTab(tabs[nextIndex], { focus: true });
    }
    function emitSelection(layer, start, end = start) {
      if (state.reviewMode !== "comment" || state.status !== "ready") return;
      const artifactId = layer.dataset.planrAnnotationLayer;
      if (!visibleArtifactIds(state).includes(artifactId)) return;
      const artifact = stageArtifactById(state, artifactId);
      if (!artifact) return;
      const region = clientSelectionToNormalized(layer.getBoundingClientRect(), start, end);
      const measured = state.presentation === "document" ? documentLayouts.get(artifactId) : null;
      const detail = Object.freeze({
        schemaVersion: "1.0.0",
        artifactId,
        region,
        viewport: measured ?? artifact.viewport
      });
      emit(root, window, ARTIFACT_STAGE_EVENTS.region, detail);
      emit(root, window, ARTIFACT_STAGE_EVENTS.point, detail);
      if (state.presentation === "document") {
        dispatch({ type: "set-review-mode", reviewMode: "interact" });
      }
    }
    for (const layer of document2.querySelectorAll("[data-planr-annotation-layer]")) {
      let selection = null;
      let selectionPreview = null;
      listen(layer, "pointerdown", (event) => {
        if (event.button !== 0 || state.reviewMode !== "comment" || state.status !== "ready") return;
        if (event.target !== layer) return;
        event.preventDefault();
        selection = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY } };
        layer.setPointerCapture?.(event.pointerId);
        selectionPreview = document2.createElement("span");
        selectionPreview.className = "planr-region-selection";
        selectionPreview.setAttribute("aria-hidden", "true");
        layer.append(selectionPreview);
      });
      listen(layer, "pointermove", (event) => {
        if (!selection || selection.pointerId !== event.pointerId || !selectionPreview) return;
        const region = clientSelectionToNormalized(
          layer.getBoundingClientRect(),
          selection.start,
          { x: event.clientX, y: event.clientY }
        );
        selectionPreview.style.left = `${region.x * 100}%`;
        selectionPreview.style.top = `${region.y * 100}%`;
        selectionPreview.style.width = `${region.w * 100}%`;
        selectionPreview.style.height = `${region.h * 100}%`;
      });
      listen(layer, "pointercancel", (event) => {
        if (!selection || selection.pointerId !== event.pointerId) return;
        layer.releasePointerCapture?.(event.pointerId);
        selection = null;
        selectionPreview?.remove();
        selectionPreview = null;
      });
      listen(layer, "pointerup", (event) => {
        if (!selection || selection.pointerId !== event.pointerId) return;
        const start = selection.start;
        layer.releasePointerCapture?.(event.pointerId);
        selection = null;
        selectionPreview?.remove();
        selectionPreview = null;
        emitSelection(layer, start, { x: event.clientX, y: event.clientY });
      });
      listen(layer, "keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        if (event.target !== layer) return;
        event.preventDefault();
        const bounds = layer.getBoundingClientRect();
        emitSelection(layer, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      });
    }
    for (const [artifactId, frame] of frames) {
      listen(frame, ARTIFACT_STAGE_EVENTS.layout, (event) => {
        if (state.presentation !== "document") return;
        const width = event.detail?.width;
        const height = event.detail?.height;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > ARTIFACT_STAGE_LIMITS.maxDocumentWidth || height < 1 || height > ARTIFACT_STAGE_LIMITS.maxDocumentHeight) return;
        const layout = Object.freeze({ width, height });
        documentLayouts.set(artifactId, layout);
        const panel = panels.get(artifactId);
        if (!panel) return;
        panel.dataset.planrLayoutMeasured = "true";
        panel.style.setProperty("--planr-document-width", `${width}px`);
        panel.style.setProperty("--planr-document-height", `${height}px`);
      });
    }
    listen(root, "click", onClick);
    listen(document2, "keydown", onKeyDown);
    listen(document2, "click", (event) => {
      const more = document2.querySelector(".planr-more-menu:not([hidden])");
      if (!more || event.target.closest?.(".planr-more")) return;
      more.hidden = true;
      document2.querySelector('[data-planr-action="more"]')?.setAttribute("aria-expanded", "false");
    });
    const roomStateObserver = typeof window.MutationObserver === "function" ? new window.MutationObserver(() => {
      if (root.hasAttribute("data-planr-room-comments-paused") && state.reviewMode === "comment") {
        dispatch({ type: "set-review-mode", reviewMode: "interact" });
      } else {
        render();
      }
    }) : null;
    roomStateObserver?.observe(root, {
      attributes: true,
      attributeFilter: ["data-planr-room-comments-paused"]
    });
    if (roomStateObserver) cleanup.push(() => roomStateObserver.disconnect());
    render();
    let readyPromise = Promise.resolve(state);
    let feedbackController = null;
    let annotationController = null;
    let shareController = null;
    let hostedController = null;
    const controller = Object.freeze({
      frameBudget,
      ensureFrames,
      getLoadedArtifactIds: () => [...frameLoads].filter(([, record2]) => record2.status === "ready").map(([id]) => id),
      getState: () => state,
      getFrame: (artifactId) => frames.get(artifactId) ?? null,
      getPanel: (artifactId) => panels.get(artifactId) ?? null,
      get review() {
        return feedbackController;
      },
      get annotations() {
        return annotationController;
      },
      get share() {
        return shareController;
      },
      get hosted() {
        return hostedController;
      },
      get ready() {
        return readyPromise;
      },
      dispatch,
      destroy() {
        if (["creating", "ambiguous"].includes(shareController?.getState?.().phase)) {
          shareController.destroy?.();
          return false;
        }
        disposed = true;
        for (const id of [...frameLoads.keys()]) releaseFrame(id);
        for (const remove of cleanup.splice(0)) remove();
        return true;
      }
    });
    window.__openPlanrArtifactStage = controller;
    feedbackController = mountArtifactFeedbackRail({
      document: document2,
      window,
      root,
      stageController: controller,
      reviewOf: reviewConfig?.reviewOf,
      initialReview: reviewConfig?.review ?? null,
      artifacts: state.artifacts,
      ...reviewOptions
    });
    annotationController = mountArtifactAnnotations({
      document: document2,
      window,
      root,
      stageController: controller,
      reviewController: feedbackController
    });
    shareController = mountArtifactShareDialog({
      document: document2,
      window,
      root,
      stageController: controller,
      ...shareOptions
    });
    hostedController = mountHostedArtifactViewer({
      document: document2,
      window,
      ...hostedOptions
    });
    if (feedbackController?.destroy) cleanup.push(() => feedbackController.destroy());
    if (annotationController?.destroy) cleanup.push(() => annotationController.destroy());
    if (shareController?.destroy) cleanup.push(() => shareController.destroy());
    if (hostedController?.destroy) cleanup.push(() => hostedController.destroy());
    function cancelledFrame() {
      const error = new Error("Artifact frame loading was cancelled.");
      error.name = "AbortError";
      return error;
    }
    function frameStatus(artifactId, status) {
      const frame = frames.get(artifactId);
      if (frame) frame.dataset.planrFrameState = status;
      if (!disposed) emit(root, window, "planr:artifact-frame-state", { artifactId, status });
    }
    function releaseFrame(artifactId, { status = "unloaded", error = cancelledFrame() } = {}) {
      const record2 = frameLoads.get(artifactId);
      if (!record2) return;
      frameLoads.delete(artifactId);
      record2.cancelled = true;
      record2.abort.abort();
      record2.unlisten?.();
      record2.detach?.();
      record2.reject(error);
      const frame = frames.get(artifactId);
      frame.removeAttribute("srcdoc");
      frame.removeAttribute("src");
      delete frame.dataset.planrArtifactDigest;
      delete frame.dataset.planrBridgeTrusted;
      try {
        delete frame.__openPlanrBridge;
      } catch {
      }
      if (record2.sourceUrl) window.URL.revokeObjectURL(record2.sourceUrl);
      documentLayouts.delete(artifactId);
      const panel = panels.get(artifactId);
      if (panel) {
        delete panel.dataset.planrLayoutMeasured;
        panel.style.removeProperty("--planr-document-width");
        panel.style.removeProperty("--planr-document-height");
      }
      frameStatus(artifactId, status);
    }
    function assignArtifactSource(artifact) {
      if (disposed) return Promise.reject(cancelledFrame());
      const existing = frameLoads.get(artifact.id);
      if (existing) {
        if (existing.status === "ready" && existing.requireTrust && frames.get(artifact.id)?.dataset.planrBridgeTrusted !== "true") {
          releaseFrame(artifact.id);
        } else {
          existing.used = ++frameUse;
          return existing.promise;
        }
      }
      const frame = frames.get(artifact.id);
      if (!frame) return Promise.reject(new Error(`Missing artifact frame: ${artifact.id}`));
      const record2 = {
        status: "loading",
        used: ++frameUse,
        cancelled: false,
        abort: typeof window.AbortController === "function" ? new window.AbortController() : { signal: void 0, abort() {
        } }
      };
      record2.promise = new Promise((resolve, reject) => {
        record2.resolve = resolve;
        record2.reject = reject;
      });
      frameLoads.set(artifact.id, record2);
      const current = () => !disposed && !record2.cancelled && frameLoads.get(artifact.id) === record2;
      const fail = (error) => {
        if (current()) releaseFrame(artifact.id, { status: "error", error });
      };
      const timer = frameBudget === null ? null : window.setTimeout(() => fail(new Error(`Artifact frame did not finish loading: ${artifact.id}`)), 15e3);
      let loaded = false;
      const ready = () => {
        if (!current() || !loaded || record2.requireTrust && frame.dataset.planrBridgeTrusted !== "true") return;
        record2.status = "ready";
        record2.unlisten();
        frameStatus(artifact.id, "ready");
        record2.resolve(artifact.id);
      };
      const onLoad = () => {
        loaded = true;
        ready();
      };
      const onError = () => fail(new Error(`Artifact frame failed: ${artifact.id}`));
      record2.unlisten = () => {
        window.clearTimeout(timer);
        frame.removeEventListener("load", onLoad);
        frame.removeEventListener("error", onError);
        frame.removeEventListener("planr:artifact-bridge-ready", ready);
      };
      frameStatus(artifact.id, "loading");
      if (!current()) return record2.promise;
      void (async () => {
        const source = await resolveArtifactSource(artifact, {
          frame,
          getState: () => state,
          signal: record2.abort.signal
        });
        if (!current()) return;
        if (typeof window.TextDecoder !== "function") {
          const error = new Error("UTF-8 decoding support is required for artifact sources.");
          error.code = "E_ARTIFACT_BROWSER_UNSUPPORTED";
          throw error;
        }
        const html = await htmlForSource(window, source);
        if (!current()) return;
        if (!html) {
          throw new TypeError(
            `Artifact source resolver must return HTML bytes or a Blob for ${artifact.id}.`
          );
        }
        if (typeof bridgeClient?.attach === "function") {
          const detach = bridgeClient.attach({
            artifact,
            frame,
            getState: () => state
          });
          if (typeof detach === "function") record2.detach = detach;
          record2.requireTrust = frameBudget !== null;
        }
        frame.addEventListener("load", onLoad);
        frame.addEventListener("error", onError);
        frame.addEventListener("planr:artifact-bridge-ready", ready);
        frame.dataset.planrArtifactDigest = artifact.sha256;
        if (sourceTransport === "srcdoc") {
          frame.removeAttribute("src");
          frame.srcdoc = html;
        } else {
          if (typeof window.URL?.createObjectURL !== "function" || typeof window.Blob !== "function") {
            const error = new Error("Blob URL support is required for artifact sources.");
            error.code = "E_ARTIFACT_BROWSER_UNSUPPORTED";
            throw error;
          }
          const sourceUrl = window.URL.createObjectURL(new window.Blob([html], {
            type: "text/html;charset=utf-8"
          }));
          record2.sourceUrl = sourceUrl;
          frame.removeAttribute("srcdoc");
          frame.src = sourceUrl;
        }
      })().catch(fail);
      return record2.promise;
    }
    function ensureFrames(artifactIds) {
      if (disposed) return Promise.reject(cancelledFrame());
      if (!Array.isArray(artifactIds) || artifactIds.some((id) => typeof id !== "string" || !frames.has(id))) {
        return Promise.reject(new TypeError("Requested artifact frames must be known artifact IDs."));
      }
      const requested = [...new Set(artifactIds)];
      if (frameBudget !== null && requested.length > frameBudget) {
        return Promise.reject(new RangeError(`At most ${frameBudget} artifact frames may be requested together.`));
      }
      if (frameBudget === null) return Promise.all(requested.map((id) => assignArtifactSource(stageArtifactById(state, id))));
      const run = async () => {
        if (disposed) throw cancelledFrame();
        for (const id of requested) {
          if (disposed) throw cancelledFrame();
          if (!frameLoads.has(id)) {
            while (frameLoads.size >= frameBudget) {
              const candidates = [...frameLoads].filter(([loadedId]) => !requested.includes(loadedId)).sort((a, b) => a[1].used - b[1].used);
              if (!candidates.length) throw new Error("The artifact frame budget is exhausted.");
              releaseFrame(candidates[0][0]);
            }
          }
          await assignArtifactSource(stageArtifactById(state, id));
        }
        return requested;
      };
      const result = frameQueue.then(run);
      frameQueue = result.catch(() => {
      });
      return result;
    }
    if (state.status === "ready" && state.artifacts.length > 0) {
      if (typeof resolveArtifactSource !== "function") {
        state = reduceArtifactStageState(state, { type: "set-status", status: "loading" });
        render();
        readyPromise = Promise.resolve(state);
      } else {
        state = reduceArtifactStageState(state, { type: "set-status", status: "loading" });
        render();
        readyPromise = (frameBudget === null ? Promise.all(state.artifacts.map(assignArtifactSource)) : ensureFrames([state.activeArtifactId])).then(() => {
          if (disposed) return state;
          state = reduceArtifactStageState(state, { type: "set-status", status: "ready" });
          render({ announce: true });
          return state;
        }).catch((error) => {
          if (disposed) return state;
          const status = error?.code === "E_ARTIFACT_BROWSER_UNSUPPORTED" ? "unsupported-browser" : "invalid";
          state = reduceArtifactStageState(state, { type: "set-status", status });
          render({ announce: true });
          return state;
        });
      }
    }
    return controller;
  }
  function bootstrapArtifactStage(document2 = globalThis.document, options = {}) {
    return mountArtifactStage({ ...options, document: document2, window: document2?.defaultView });
  }
  if (typeof document !== "undefined") {
    const options = globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ ?? {};
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => bootstrapArtifactStage(document, options), { once: true });
    } else {
      queueMicrotask(() => bootstrapArtifactStage(document, options));
    }
  }
  return __toCommonJS(stage_exports);
})();
