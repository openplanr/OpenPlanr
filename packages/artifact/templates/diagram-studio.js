(() => {
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
    const startX = clamp(
      finite(start?.x ?? start?.clientX, rect.left),
      rect.left,
      rect.left + rect.width
    );
    const startY = clamp(
      finite(start?.y ?? start?.clientY, rect.top),
      rect.top,
      rect.top + rect.height
    );
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
    return text(
      reviewController?.getIdentity?.()?.name,
      ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength
    );
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
      return [...document2.querySelectorAll("[data-planr-annotation-layer]")].find(
        (node) => node.dataset.planrAnnotationLayer === artifactId
      ) ?? null;
    }
    function frameFor(artifactId) {
      return [...document2.querySelectorAll("[data-planr-artifact-frame]")].find(
        (node) => node.dataset.planrArtifactFrame === artifactId
      ) ?? null;
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
          announce(
            document2,
            "This pin’s element is not currently visible. The original comment remains in Review."
          );
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
    function setPinPosition(record, region) {
      const point = { x: region.x + region.w / 2, y: region.y + region.h / 2, w: 0, h: 0 };
      setRegionStyle(record.button, point);
      if (record.region) setRegionStyle(record.region, region);
      if (record.button.hidden) record.button.hidden = false;
      if (record.region?.hidden) record.region.hidden = false;
    }
    function hidePin(record) {
      if (!record.button.hidden) record.button.hidden = true;
      if (record.region && !record.region.hidden) record.region.hidden = true;
    }
    function removePin(record) {
      record.pending = null;
      record.button.remove();
      record.region?.remove();
    }
    function refreshAnchors() {
      if (destroyed) return;
      const now = window.performance.now();
      const frames = new Map(
        [...document2.querySelectorAll("[data-planr-artifact-frame]")].map((frame) => [
          frame.dataset.planrArtifactFrame,
          frame
        ])
      );
      const records = [...pinRecords.values()].flatMap((records2) => [...records2.values()]).filter((record) => record.pin.anchor?.planrId).sort((a, b) => a.requestedAt - b.requestedAt);
      for (const record of records) {
        if (record.pending || now - record.requestedAt < 200 || !record.button.isConnected) continue;
        const frame = frames.get(record.pin.artifactId);
        const bridge = frame?.__openPlanrBridge;
        if (!bridge?.resolve || frame.closest("[hidden]") || frame.dataset.planrBridgeTrusted === "false" || (anchorRequests.get(frame) ?? 0) >= 8)
          continue;
        const request = {}, key = record.geometryKey, pin = record.pin;
        record.pending = request;
        record.requestedAt = now;
        anchorRequests.set(frame, (anchorRequests.get(frame) ?? 0) + 1);
        Promise.resolve().then(() => bridge.resolve(pin.anchor.planrId, pin.anchor.screen)).then((anchor) => {
          if (destroyed || record.pending !== request || record.geometryKey !== key || !record.button.isConnected || frame.__openPlanrBridge !== bridge)
            return;
          if (!anchor || anchor.rect.width <= 0 || anchor.rect.height <= 0) {
            hidePin(record);
            if (record.button.dataset.planrAnchorStatus !== "unavailable")
              record.button.dataset.planrAnchorStatus = "unavailable";
            return;
          }
          const projected = anchorRegionToViewportRegion(
            pin.region,
            anchor.viewport ?? pin.viewport,
            anchor.rect
          );
          setPinPosition(record, projected);
          if (record.button.dataset.planrAnchorStatus !== "resolved")
            record.button.dataset.planrAnchorStatus = "resolved";
        }).catch(() => {
        }).finally(() => {
          const remaining = (anchorRequests.get(frame) ?? 1) - 1;
          if (remaining > 0) anchorRequests.set(frame, remaining);
          else anchorRequests.delete(frame);
          if (record.pending === request) record.pending = null;
        });
      }
    }
    function renderPins() {
      if (destroyed) return;
      const pins = Array.isArray(review()?.pins) ? review().pins : [];
      const layers = new Set(document2.querySelectorAll("[data-planr-annotation-layer]"));
      for (const [layer, records] of pinRecords) {
        if (layers.has(layer)) continue;
        for (const record of records.values()) removePin(record);
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
          let record = records.get(pin.id);
          if (!record) {
            const button = make(document2, "button", {
              attributes: {
                type: "button",
                id: ids.pin,
                "data-planr-pin-id": pin.id,
                "aria-controls": ids.thread
              }
            });
            button.addEventListener("click", () => focusThread(pin.id));
            layer.append(button);
            record = {
              button,
              region: null,
              pin,
              geometryKey: null,
              pending: null,
              requestedAt: -Infinity
            };
            records.set(pin.id, record);
          }
          record.pin = pin;
          if (hasRegion && !record.region) {
            record.region = make(document2, "span", {
              attributes: { "data-planr-pin-region-id": pin.id, "aria-hidden": "true" }
            });
            layer.insertBefore(record.region, record.button);
          } else if (!hasRegion && record.region) {
            record.region.remove();
            record.region = null;
          }
          const buttonClass = `planr-pin planr-pin-${pin.intent} planr-pin-${pin.status}${hasRegion ? " planr-pin-region-handle" : ""}${record.button.classList.contains("planr-pin-highlight") ? " planr-pin-highlight" : ""}`;
          if (record.button.className !== buttonClass) record.button.className = buttonClass;
          if (record.button.textContent !== String(ordinal))
            record.button.textContent = String(ordinal);
          for (const [name, value] of Object.entries({
            "data-planr-intent": pin.intent,
            "data-planr-status": pin.status,
            "aria-label": `${pin.intent} comment ${ordinal}: ${pin.comment}`
          })) {
            if (record.button.getAttribute(name) !== value) record.button.setAttribute(name, value);
          }
          if (record.region) {
            const regionClass = `planr-pin-region planr-pin-region-${pin.intent} planr-pin-region-${pin.status}`;
            if (record.region.className !== regionClass) record.region.className = regionClass;
          }
          const key = pinGeometryKey(pin);
          if (record.geometryKey !== key) {
            record.geometryKey = key;
            record.pending = null;
            record.requestedAt = -Infinity;
            if (pin.anchor?.planrId) hidePin(record);
            else {
              delete record.button.dataset.planrAnchorStatus;
              setPinPosition(record, pin.region);
            }
          }
        }
        for (const [id, record] of records) {
          if (!current.has(id)) {
            removePin(record);
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
      const viewport = {
        x: finite(visual?.offsetLeft),
        y: finite(visual?.offsetTop),
        width: finite(visual?.width, window.innerWidth),
        height: finite(visual?.height, window.innerHeight)
      };
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
      const close = make(document2, "button", {
        textContent: "×",
        attributes: {
          type: "button",
          "data-planr-composer-close": "",
          "aria-label": "Close new comment",
          title: "Close new comment (Escape)"
        }
      });
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
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
          return;
        const options = [...intentPicker.querySelectorAll("[data-planr-intent]")];
        const current = options.findIndex((option) => option.getAttribute("aria-checked") === "true");
        const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (Math.max(0, current) + delta + options.length) % options.length;
        event.preventDefault();
        options[nextIndex].click();
        options[nextIndex].focus();
      });
      listen(close, "click", () => closeComposer({ restoreFocus: true }));
      listen(
        composer.querySelector("[data-planr-composer-cancel]"),
        "click",
        () => {
          closeComposer({ restoreFocus: true });
        },
        { once: true }
      );
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
      root.dispatchEvent(
        new window.CustomEvent(ARTIFACT_ANNOTATION_EVENTS.draft, {
          bubbles: true,
          detail: Object.freeze({ ...draft })
        })
      );
      if (restoredDraft) {
        identity.value = restoredDraft.identity;
        comment.value = restoredDraft.comment;
        selectedIntent = restoredDraft.intent;
        for (const option of intentPicker.querySelectorAll("[data-planr-intent]")) {
          const selected = option.dataset.planrIntent === selectedIntent;
          option.setAttribute("aria-checked", String(selected));
          option.tabIndex = selected ? 0 : -1;
        }
        if (Number.isInteger(restoredDraft.selectionStart))
          comment.setSelectionRange(
            restoredDraft.selectionStart,
            restoredDraft.selectionEnd,
            restoredDraft.selectionDirection
          );
        const fields = new Map(
          Object.entries(restoredDraft.fields ?? {}).slice(0, 32).filter(
            ([key, value]) => key.length <= 128 && typeof value === "string" && value.length <= ARTIFACT_ANNOTATION_LIMITS.maxCommentLength
          )
        );
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
        fields: Object.fromEntries(
          [...composer.querySelectorAll("[data-planr-draft-key]")].slice(0, 32).filter(
            (field) => field.dataset.planrDraftKey.length <= 128 && typeof field.value === "string"
          ).map((field) => [
            field.dataset.planrDraftKey,
            field.value.slice(0, ARTIFACT_ANNOTATION_LIMITS.maxCommentLength)
          ])
        ),
        comment: comment.value,
        intent: composer.querySelector('[data-planr-intent][aria-checked="true"]')?.dataset.planrIntent ?? "fix",
        selectionStart: comment.selectionStart,
        selectionEnd: comment.selectionEnd,
        selectionDirection: comment.selectionDirection
      });
    }
    function restoreDraft(snapshot) {
      if (!snapshot || snapshot.reviewOf !== (reviewController.getReviewOf?.() ?? review()?.reviewOf ?? null))
        return false;
      const artifact = stageController.getState().artifacts.find((entry) => entry.id === snapshot.artifactId);
      if (!artifact || artifact.viewport.width !== snapshot.viewport?.width || artifact.viewport.height !== snapshot.viewport?.height || !["x", "y", "w", "h"].every(
        (key) => Number.isFinite(snapshot.region?.[key]) && snapshot.region[key] >= 0 && snapshot.region[key] <= 1
      ) || !["x", "y", "w", "h"].every(
        (key) => Number.isFinite(snapshot.displayRegion?.[key]) && snapshot.displayRegion[key] >= 0 && snapshot.displayRegion[key] <= 1
      ) || typeof snapshot.comment !== "string" || snapshot.comment.length > ARTIFACT_ANNOTATION_LIMITS.maxCommentLength || typeof snapshot.identity !== "string" || snapshot.identity.length > ARTIFACT_ANNOTATION_LIMITS.maxIdentityLength || !INTENTS.includes(snapshot.intent) || snapshot.anchor && (typeof snapshot.anchor.planrId !== "string" || snapshot.anchor.planrId.length > 512))
        return false;
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
        if (suspendedDraft && state.status === "ready" && state.reviewMode === "comment" && visible.includes(suspendedDraft.artifactId))
          restoreDraft(suspendedDraft);
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
        for (const records of pinRecords.values())
          for (const record of records.values()) removePin(record);
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
    const normalized2 = trim ? value.trim() : value;
    if (normalized2.length < min || max !== void 0 && normalized2.length > max) {
      invalid(`${label} must contain ${min} through ${max ?? "unlimited"} characters.`);
    }
    if (pattern && !pattern.test(normalized2)) invalid(`${label} has an invalid format.`);
    return normalized2;
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
    if (!reply || typeof reply !== "object" || Array.isArray(reply))
      invalid(`${label} must be an object.`);
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
    const replies = pin.replies.map(
      (reply, index) => normalizeReply(reply, `${label}.replies[${index}]`)
    );
    const replyIds = new Set(replies.map(({ id }) => id));
    if (replyIds.size !== replies.length) invalid(`${label}.replies must have unique ids.`);
    const normalized2 = {
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
    if (variant !== void 0) normalized2.variant = variant;
    if (anchor !== void 0) normalized2.anchor = anchor;
    return normalized2;
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
    const normalized2 = {
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
    if (review.createdAt !== void 0)
      normalized2.createdAt = isoTimestamp(review.createdAt, "review.createdAt");
    if (review.updatedAt !== void 0)
      normalized2.updatedAt = isoTimestamp(review.updatedAt, "review.updatedAt");
    return deepFreezeArtifactReview(normalized2);
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
      throw new ArtifactReviewStateError(
        "E_ARTIFACT_REVIEW_PIN_NOT_FOUND",
        `Unknown feedback pin: ${normalizedId}`
      );
    }
    return pin;
  }
  function preserveOptionalReviewTimestamps(review, next, timestamp) {
    if (review.createdAt !== void 0) next.createdAt = review.createdAt;
    if (review.updatedAt !== void 0) next.updatedAt = timestamp;
    return next;
  }
  function reduceArtifactReview(review, action, { createId = defaultCreateId, now = defaultNow } = {}) {
    const current = normalizeArtifactReview(review);
    if (!action || typeof action !== "object" || Array.isArray(action))
      invalid("Review action must be an object.");
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
          throw new ArtifactReviewStateError(
            "E_ARTIFACT_REVIEW_ID_COLLISION",
            `Duplicate pin id: ${pinId}`
          );
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
        next = preserveOptionalReviewTimestamps(
          current,
          {
            ...current,
            pins: [...current.pins, pin]
          },
          timestamp
        );
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
          throw new ArtifactReviewStateError(
            "E_ARTIFACT_REVIEW_ID_COLLISION",
            `Duplicate reply id: ${replyId}`
          );
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
        next = preserveOptionalReviewTimestamps(
          current,
          {
            ...current,
            pins: replacePin(current, updatedPin)
          },
          timestamp
        );
        break;
      }
      case "set-status": {
        const pin = findPin(current, action.pinId);
        const updatedPin = normalizePin({
          ...pin,
          status: enumValue(action.status, ARTIFACT_REVIEW_STATUSES, "status"),
          updatedAt: timestamp
        });
        next = preserveOptionalReviewTimestamps(
          current,
          {
            ...current,
            pins: replacePin(current, updatedPin)
          },
          timestamp
        );
        break;
      }
      case "set-overall":
        next = preserveOptionalReviewTimestamps(
          current,
          {
            ...current,
            overall: boundedString(action.overall, "overall", { max: ARTIFACT_REVIEW_LIMITS.text })
          },
          timestamp
        );
        break;
      case "set-decision":
        next = preserveOptionalReviewTimestamps(
          current,
          {
            ...current,
            decision: enumValue(action.decision, ARTIFACT_REVIEW_DECISIONS, "decision")
          },
          timestamp
        );
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
        throw new ArtifactReviewStateError(
          "E_ARTIFACT_REVIEW_DESTROYED",
          "Artifact review controller is destroyed."
        );
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
  function createElement(document2, tagName, { className, text: text2, attributes = {} } = {}) {
    const element = document2.createElement(tagName);
    if (className) element.className = className;
    if (text2 !== void 0) element.textContent = text2;
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
    const item = createElement(document2, "li", {
      className: "planr-reply",
      attributes: { "data-planr-reply-id": reply.id }
    });
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
      attributes: {
        "data-planr-reply-form": pin.id,
        id: `${fieldId}-form`,
        ...expanded ? {} : { hidden: "" }
      }
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
    const hint = createElement(document2, "span", {
      className: "planr-reply-hint",
      text: "Ctrl/⌘ + Enter to send"
    });
    const submit = createElement(document2, "button", {
      className: "planr-reply-send",
      attributes: {
        type: "submit",
        disabled: "",
        "aria-label": "Send reply",
        title: "Send reply (Ctrl/⌘ + Enter)"
      }
    });
    const svg = document2.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false"
    }))
      svg.setAttribute(name, value);
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
      createElement(document2, "span", {
        className: "planr-thread-status",
        text: pin.status,
        attributes: { title: `Status: ${pin.status}` }
      }),
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
    for (const reply of pin.replies.slice(earlierReplies))
      replies.append(renderReply(document2, reply));
    const editor = renderReplyForm(document2, pin, description.replyExpanded);
    article.append(header, comment);
    if (description.compact && pin.comment.length > 240) {
      comment.dataset.planrCommentCollapsed = String(!description.commentExpanded);
      article.append(
        createElement(document2, "button", {
          className: "planr-comment-expand",
          text: description.commentExpanded ? "Show less" : "Read full comment",
          attributes: {
            type: "button",
            id: `${annotationDomIds(pin.id).thread}-expand`,
            "data-planr-comment-expand": pin.id,
            "aria-expanded": String(Boolean(description.commentExpanded))
          }
        })
      );
    }
    if (earlierReplies)
      article.append(
        createElement(document2, "button", {
          className: "planr-history-expand",
          text: `Show ${earlierReplies} earlier ${earlierReplies === 1 ? "reply" : "replies"}`,
          attributes: {
            type: "button",
            id: `${annotationDomIds(pin.id).thread}-history`,
            "data-planr-history-expand": pin.id,
            "aria-expanded": "false"
          }
        })
      );
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
        if (typeof field.value === "string")
          extraDrafts.set(field.dataset.planrDraftKey, field.value);
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
    const emitDraftChange = () => root.dispatchEvent(
      new window.CustomEvent(ARTIFACT_REVIEW_DRAFT_CHANGE_EVENT, {
        bubbles: true,
        detail: snapshotDrafts()
      })
    );
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
      const target = descriptor.id && document2.getElementById(descriptor.id) || descriptor.draftKey && [...slot.querySelectorAll("[data-planr-draft-key]")].find(
        (field) => field.dataset.planrDraftKey === descriptor.draftKey
      ) || descriptor.action && [...thread?.querySelectorAll("[data-planr-thread-action]") ?? []].find(
        (button) => button.dataset.planrThreadAction === descriptor.action
      ) || descriptor.showPin && thread?.querySelector("[data-planr-thread-focus]") || [...thread?.querySelectorAll("button,input,select,textarea") ?? []].find(
        (field) => field.tagName === descriptor.tag && field.name === descriptor.name
      );
      target?.focus?.({ preventScroll: true });
      if (Number.isInteger(descriptor.start))
        target?.setSelectionRange?.(descriptor.start, descriptor.end, descriptor.direction);
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
      for (const count of root.querySelectorAll(
        '[data-planr-action="feedback"] .planr-count, .planr-review-rail > header .planr-count'
      )) {
        count.textContent = String(pins.length);
        count.setAttribute("aria-label", label);
      }
      const commentsButton = root.querySelector('[data-planr-action="feedback"]');
      commentsButton?.setAttribute("aria-label", commentsButton.dataset.planrReviewLabel || label);
      if (commentsButton?.dataset.planrReviewLabel)
        commentsButton.setAttribute("aria-description", label);
    };
    const render = ({ capture = true } = {}) => {
      if (composing) {
        renderQueued = true;
        return;
      }
      if (capture) captureDrafts();
      const focus = focusDescriptor();
      const scroll = [];
      for (let node = slot; node && root.contains(node); node = node.parentElement)
        scroll.push([node, node.scrollTop, node.scrollLeft]);
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
        list.append(
          createElement(document2, "p", {
            className: "planr-review-empty",
            text: typeof presentation.emptyMessage === "string" ? presentation.emptyMessage : allPins.length ? "No comments match these filters." : "No comments yet. Choose Add comment, then select a point or region in the artifact."
          })
        );
      } else {
        for (const pin of visiblePins) {
          const thread = renderThread(document2, pin, pin.id === activePinId, {
            ...presentation.describePin?.(pin, state),
            compact: presentation.compact === true,
            replyLimit: expandedHistory.get(pin.id) || 2,
            commentExpanded: expandedComments.has(pin.id),
            replyExpanded: expandedReplies.has(pin.id)
          });
          presentation.decorateThread?.({ element: thread, pin, state, document: document2 });
          const reply = thread.querySelector('[name="reply"]');
          if (replyDrafts.has(pin.id)) reply.value = replyDrafts.get(pin.id);
          thread.querySelector(".planr-reply-send").disabled = !reply.value.trim();
          for (const field of thread.querySelectorAll("[data-planr-draft-key]")) {
            if (extraDrafts.has(field.dataset.planrDraftKey))
              field.value = extraDrafts.get(field.dataset.planrDraftKey);
          }
          list.append(thread);
        }
      }
      if (pins.length > visibleLimit)
        list.append(
          createElement(document2, "button", {
            className: "planr-threads-more",
            text: `Show more comments · ${Math.min(visibleLimit, pins.length)} of ${pins.length}`,
            attributes: { type: "button", "data-planr-threads-more": "" }
          })
        );
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
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.planrDecision === (review?.decision ?? "pending"))
        );
      }
      decisionStatus.textContent = decisionCopy(review?.decision ?? "pending");
      updateCounts(allPins);
      restoreFocus(focus);
      for (const [node, top, left] of scroll) {
        node.scrollTop = top;
        node.scrollLeft = left;
      }
      const openMetric = root.querySelector('[data-planr-metric="open"]');
      if (openMetric)
        openMetric.textContent = `${allPins.filter(({ status }) => status !== "resolved").length} open`;
    };
    const focusThread = (pinId) => {
      const thread = document2.getElementById(artifactReviewThreadDomId(pinId));
      thread?.focus({ preventScroll: true });
      thread?.scrollIntoView?.({ block: "nearest" });
    };
    const emitReview = (review) => {
      const detail = cloneFrozenArtifactReview(review);
      root.dispatchEvent(
        new window.CustomEvent(ARTIFACT_REVIEW_CHANGE_EVENT, {
          detail,
          bubbles: true
        })
      );
    };
    const unsubscribe = controller.subscribe((state, change) => {
      if (destroyed) return;
      if (["review", "review-replaced", "selection"].includes(change.type)) render();
      if (["review", "review-replaced"].includes(change.type) && state.review)
        emitReview(state.review);
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
      if (focus)
        (expanded ? form.elements.namedItem("reply") : toggle).focus({ preventScroll: true });
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
      root.dispatchEvent(
        new window.CustomEvent(ARTIFACT_REVIEW_SELECT_EVENT, {
          detail: deepFreezeArtifactReview({ pinId, source: "thread" }),
          bubbles: true
        })
      );
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
        setReplyExpanded(
          replyToggle.dataset.planrReplyToggle,
          replyToggle.getAttribute("aria-expanded") !== "true",
          { focus: true }
        );
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
          announce2(
            action.dataset.planrThreadAction === "resolve" ? "Comment resolved" : "Comment reopened"
          );
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
      root.dispatchEvent(
        new window.CustomEvent("planr:artifact-thread-open", {
          bubbles: true,
          detail: Object.freeze({ pinId: pin.id })
        })
      );
    };
    const onDraftInput = (event) => {
      const form = event.target.closest?.("[data-planr-reply-form]");
      if (form)
        form.querySelector(".planr-reply-send").disabled = !form.elements.namedItem("reply").value.trim();
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
        if (options.filterKey !== presentation.filterKey || options.pageSize !== void 0 && options.pageSize !== presentation.pageSize)
          visibleLimit = options.pageSize || presentation.pageSize || Infinity;
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
        for (const [id, value] of Object.entries(snapshot.replies ?? {}).slice(
          0,
          ARTIFACT_REVIEW_LIMITS.pins
        )) {
          if (id.length <= ARTIFACT_REVIEW_LIMITS.id && typeof value === "string")
            replyDrafts.set(id, value.slice(0, ARTIFACT_REVIEW_LIMITS.text));
        }
        expandedReplies.clear();
        const expanded = Array.isArray(snapshot.expandedReplies) ? snapshot.expandedReplies : [...replyDrafts.keys()];
        for (const id of expanded.slice(0, ARTIFACT_REVIEW_LIMITS.pins))
          if (typeof id === "string" && id.length <= ARTIFACT_REVIEW_LIMITS.id)
            expandedReplies.add(id);
        for (const [key, value] of Object.entries(snapshot.fields ?? {}).slice(
          0,
          ARTIFACT_REVIEW_LIMITS.pins
        )) {
          if (key.length <= 512 && typeof value === "string")
            extraDrafts.set(key, value.slice(0, ARTIFACT_REVIEW_LIMITS.text));
        }
        overallDirty = snapshot.overall?.dirty === true;
        if (overallDirty && typeof snapshot.overall?.value === "string")
          overall.value = snapshot.overall.value.slice(0, ARTIFACT_REVIEW_LIMITS.text);
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

  // lib/artifact/ui/diagram-studio.mjs
  function mountDiagramStudio(document2 = globalThis.document) {
    const window = document2.defaultView;
    const root = document2.querySelector(".diagram-shell");
    const config = JSON.parse(document2.getElementById("diagram-studio-data").textContent);
    const canvas = root.querySelector(".diagram-canvas");
    const surface = root.querySelector(".diagram-scene");
    const drawing = root.querySelector(".diagram-drawing");
    const { width, height } = config.artifact.viewport;
    const camera = { x: 0, y: 0, scale: 1, fit: "all" };
    const state = {
      status: "ready",
      activeArtifactId: config.artifact.id,
      artifacts: [config.artifact],
      reviewMode: "interact"
    };
    const cleanup = [];
    const listen = (target, event, handler, options) => {
      target.addEventListener(event, handler, options);
      cleanup.push(() => target.removeEventListener(event, handler, options));
    };
    let paintId = 0, space = false, gesture = null, annotations;
    let selectedIndex = -1, connectionFocus = false, presentationIndex = 0;
    const intentLabels = { fix: "Change request", improve: "Suggestion", question: "Question" };
    const semanticAttributes = [
      "data-item-id",
      "data-relation-id",
      "data-phase-id",
      "data-group-id",
      "data-lane-id",
      "data-annotation-id",
      "data-scene-id"
    ];
    const drawingElements = [
      ...drawing.querySelectorAll(semanticAttributes.map((attribute) => `[${attribute}]`).join(","))
    ];
    const elementIndex = new Map(
      drawingElements.map((element) => [
        semanticAttributes.map((attribute) => element.getAttribute(attribute)).find(Boolean),
        element
      ])
    );
    const itemIndex = new Map(config.items.map((item, index) => [item.id, index]));
    const groups = new Map(
      config.items.filter((item) => item.kind === "Group").map((item) => [item.id, item])
    );
    const groupMembers = /* @__PURE__ */ new Map();
    const collapsedGroups = /* @__PURE__ */ new Set();
    let groupHiddenIds = /* @__PURE__ */ new Set();
    function resolveGroupMembers(id, trail = /* @__PURE__ */ new Set()) {
      if (groupMembers.has(id)) return groupMembers.get(id);
      if (trail.has(id)) return /* @__PURE__ */ new Set();
      const members = /* @__PURE__ */ new Set();
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
        height: Math.max(8, bounds.height + 8)
      };
    }
    function hitItem(x, y) {
      return config.items.map((item, index) => ({ item, index, rect: elementBounds(item.id) })).filter(
        ({ item, rect }) => !groupHiddenIds.has(item.id) && rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
      ).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0] ?? null;
    }
    drawing.dataset.planrArtifactFrame = config.artifact.id;
    drawing.__openPlanrBridge = {
      hitTest(x, y) {
        const match = hitItem(x, y);
        return match ? { planrId: match.item.id, screen: config.artifact.id, rect: match.rect } : null;
      },
      resolve(id) {
        const rect = elementBounds(id);
        return rect ? { planrId: id, rect, viewport: config.artifact.viewport } : null;
      }
    };
    const pointers = /* @__PURE__ */ new Map();
    const saveState = root.querySelector("[data-save-state]");
    let pendingReview = null, saving = false, failed = false;
    const status = (text2) => {
      root.querySelector("[data-canvas-status]").textContent = text2;
    };
    const emit = () => root.dispatchEvent(new window.CustomEvent("planr:stage-change", { detail: { ...state } }));
    const setMode = (mode) => {
      state.reviewMode = mode;
      root.dataset.planrReviewMode = mode;
      root.querySelector("[data-action=pan]").setAttribute("aria-pressed", String(mode === "interact"));
      root.querySelector("[data-action=comment]").setAttribute("aria-pressed", String(mode === "comment"));
      status(
        mode === "comment" ? "Click or drag an area to comment · Esc to pan" : "Drag anywhere to pan"
      );
      emit();
    };
    function setRail(open) {
      root.dataset.planrRailOpen = String(open);
      root.querySelector("[data-action=review]").setAttribute("aria-expanded", String(open));
      const rail = document2.getElementById("planr-review-rail");
      rail.inert = !open;
      rail.setAttribute("aria-hidden", String(!open));
      if (open && window.innerWidth <= 700) setOutline(false);
    }
    function setOutline(open) {
      root.dataset.outlineOpen = String(open);
      root.querySelector("[data-action=outline]").setAttribute("aria-expanded", String(open));
      document2.getElementById("diagram-outline").inert = !open;
      if (open && window.innerWidth <= 700) setRail(false);
    }
    const stage = {
      getState: () => state,
      dispatch(action) {
        if (action.type === "set-review-mode") setMode(action.reviewMode);
        if (action.type === "set-rail-open") setRail(action.railOpen);
      }
    };
    function draw() {
      paintId = 0;
      surface.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
      surface.style.setProperty("--diagram-inverse-zoom", String(1 / camera.scale));
      root.querySelector("[data-zoom]").textContent = `${Math.round(camera.scale * 100)}%`;
    }
    const paint = () => {
      if (!paintId) paintId = window.requestAnimationFrame(draw);
    };
    function initialFit() {
      const availableWidth = Math.max(1, canvas.clientWidth - 48);
      const availableHeight = Math.max(1, canvas.clientHeight - 116);
      const whole = Math.min(availableWidth / width, availableHeight / height);
      return whole < 0.6 && availableWidth / width > whole * 1.5 ? "width" : "all";
    }
    function fit(mode = "all") {
      camera.fit = mode;
      const availableWidth = Math.max(1, canvas.clientWidth - 48);
      const availableHeight = Math.max(1, canvas.clientHeight - 116);
      camera.scale = Math.min(
        1,
        mode === "width" ? availableWidth / width : Math.min(availableWidth / width, availableHeight / height)
      );
      camera.x = (canvas.clientWidth - width * camera.scale) / 2;
      camera.y = mode === "width" ? 24 : 24 + (availableHeight - height * camera.scale) / 2;
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
        availableHeight / Math.max(1, bounds.height)
      );
      camera.x = (canvas.clientWidth - bounds.width * camera.scale) / 2 - bounds.x * camera.scale;
      camera.y = 24 + (availableHeight - bounds.height * camera.scale) / 2 - bounds.y * camera.scale;
      canvas.scrollTop = 0;
      canvas.scrollLeft = 0;
      paint();
    }
    const sections = config.items.filter((item) => item.kind === "Section").sort((left, right) => left.y - right.y);
    const chapters = sections.length > 0 ? sections.map((item, index) => {
      const next = sections[index + 1];
      const y = Math.max(0, item.y - 46);
      return {
        id: item.id,
        label: item.label,
        bounds: {
          x: 0,
          y,
          width,
          height: Math.max(80, (next?.y ?? height) - y - (next ? 30 : 0))
        }
      };
    }) : config.items.filter((item) => item.kind === "Group").map((item) => ({ id: item.id, label: item.label, bounds: elementBounds(item.id) }));
    if (chapters.length === 0) chapters.push({ id: "overview", label: "Overview", bounds: null });
    function updateOutlineFilter() {
      const value = root.querySelector("[data-search]").value.trim().toLocaleLowerCase();
      let count = 0;
      root.querySelectorAll("[data-item-index]").forEach((button) => {
        const item = config.items[Number(button.dataset.itemIndex)];
        const matches = [item.label, item.id, item.description, item.kind].filter(Boolean).join(" ").toLocaleLowerCase().includes(value);
        button.hidden = groupHiddenIds.has(item.id) || !matches;
        if (!button.hidden) count++;
      });
      root.querySelector("[data-search-empty]").hidden = count > 0;
    }
    function applyGroupVisibility() {
      groupHiddenIds = /* @__PURE__ */ new Set();
      for (const id of collapsedGroups)
        for (const member of groupMembers.get(id) ?? []) groupHiddenIds.add(member);
      for (const relation of config.relations ?? []) {
        if (groupHiddenIds.has(relation.from) && groupHiddenIds.has(relation.to))
          groupHiddenIds.add(relation.id);
      }
      for (const item of config.items) {
        if (item.kind === "Note" && item.targetId && groupHiddenIds.has(item.targetId))
          groupHiddenIds.add(item.id);
      }
      for (const [id, element] of elementIndex) {
        element.toggleAttribute("data-group-hidden", groupHiddenIds.has(id));
        if (groups.has(id)) element.toggleAttribute("data-collapsed", collapsedGroups.has(id));
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
      document: document2,
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
          const target = document2.createElement("p");
          target.className = "diagram-thread-target";
          target.textContent = item ? `${item.kind}: ${item.label}` : "Target unavailable in this revision";
          element.querySelector("header").after(target);
        }
      }
    });
    listen(root, "planr:artifact-annotation-draft", () => {
      root.querySelectorAll("[data-planr-annotation-composer] [data-planr-intent]").forEach((button) => {
        button.textContent = intentLabels[button.dataset.planrIntent];
      });
    });
    annotations = mountArtifactAnnotations({
      root,
      document: document2,
      window,
      stageController: stage,
      reviewController: feedback,
      onFocusPin: (pin) => {
        if (pin.anchor?.planrId) expandForItem(pin.anchor.planrId);
        const rect = pin.anchor?.planrId && elementBounds(pin.anchor.planrId);
        const x = pin.region.x + pin.region.w / 2, y = pin.region.y + pin.region.h / 2;
        if (connectionFocus) {
          connectionFocus = false;
          updateSelection();
        }
        focusPoint(
          rect ? rect.x + x * rect.width : x * width,
          rect ? rect.y + y * rect.height : y * height
        );
      }
    });
    async function save() {
      if (saving || !pendingReview) return;
      saving = true;
      failed = false;
      saveState.disabled = true;
      saveState.dataset.failed = "false";
      saveState.textContent = "Saving…";
      while (pendingReview) {
        const review = pendingReview;
        pendingReview = null;
        try {
          const response = await window.fetch(`${config.base}api/review`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ review })
          });
          if (!response.ok) throw new Error("Review could not be saved");
        } catch {
          pendingReview ??= review;
          failed = true;
          saveState.disabled = false;
          saveState.dataset.failed = "true";
          saveState.textContent = "Save failed · click to retry";
          break;
        }
      }
      saving = false;
      if (!failed) saveState.textContent = "Comments saved on this computer";
    }
    listen(root, "planr:artifact-review-change", (event) => {
      pendingReview = event.detail;
      root.querySelector("[data-comment-count]").textContent = String(event.detail.pins.length);
      void save();
    });
    listen(saveState, "click", () => {
      if (failed) void save();
    });
    listen(window, "online", () => {
      if (failed) void save();
    });
    listen(window, "beforeunload", (event) => {
      if (pendingReview || saving) {
        event.preventDefault();
        event.returnValue = "";
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
        element.toggleAttribute("data-selected", id === item?.id);
        if (id === item?.id) element.dataset.selected = "true";
        element.toggleAttribute("data-dimmed", connectionFocus && !connected.has(id));
      }
      root.querySelector("[data-action=connections]").setAttribute("aria-pressed", String(connectionFocus));
    }
    function selectItem(index, { focus = true } = {}) {
      const item = config.items[index];
      if (!item) return;
      expandForItem(item.id);
      selectedIndex = index;
      root.querySelectorAll("[data-item-index]").forEach(
        (button) => button.setAttribute("aria-current", String(Number(button.dataset.itemIndex) === index))
      );
      const details = root.querySelector("[data-element-details]");
      details.hidden = false;
      details.querySelector("[data-element-label]").textContent = item.label;
      details.querySelector("[data-element-kind]").textContent = item.semanticKind ?? item.kind;
      details.querySelector("[data-element-id]").textContent = item.id;
      details.querySelector("[data-element-description]").textContent = item.description || "No supporting description provided.";
      details.querySelector("[data-element-endpoints]").textContent = item.from ? `${item.fromLabel} → ${item.toLabel}` : "";
      const groupToggle = root.querySelector("[data-action=toggle-group]");
      groupToggle.hidden = item.kind !== "Group";
      groupToggle.textContent = collapsedGroups.has(item.id) ? "Expand group details" : "Collapse group details";
      groupToggle.setAttribute("aria-pressed", String(collapsedGroups.has(item.id)));
      root.querySelector("[data-action=connections]").disabled = !(config.relations ?? []).some(
        (relation) => relation.id === item.id || relation.from === item.id || relation.to === item.id
      );
      updateSelection();
      if (focus) {
        if (window.innerWidth <= 700) setOutline(false);
        focusPoint(item.x, item.y);
      }
      status(item.label);
    }
    const search = root.querySelector("[data-search]");
    listen(search, "input", updateOutlineFilter);
    listen(search, "keydown", (event) => {
      if (event.key === "Enter") {
        const first = root.querySelector("[data-item-index]:not([hidden])");
        if (first) selectItem(Number(first.dataset.itemIndex));
      }
    });
    function showChapter(index) {
      presentationIndex = Math.max(0, Math.min(chapters.length - 1, index));
      const chapter = chapters[presentationIndex];
      root.querySelector("[data-chapter-label]").textContent = chapter.label;
      root.querySelector("[data-chapter-progress]").textContent = `${presentationIndex + 1} of ${chapters.length}`;
      root.querySelector("[data-action=previous-chapter]").disabled = presentationIndex === 0;
      root.querySelector("[data-action=next-chapter]").disabled = presentationIndex === chapters.length - 1;
      focusBounds(chapter.bounds);
      status(`Chapter ${presentationIndex + 1} of ${chapters.length} · ${chapter.label}`);
    }
    function resetPresentation() {
      root.dataset.present = "false";
      root.querySelector("[data-presentation-nav]").hidden = true;
      const button = root.querySelector("[data-action=present]");
      button.textContent = "Present";
      button.setAttribute("aria-pressed", "false");
      fit();
    }
    async function present() {
      const active = root.dataset.present !== "true";
      root.dataset.present = String(active);
      setRail(false);
      root.querySelector("[data-presentation-nav]").hidden = !active;
      const button = root.querySelector("[data-action=present]");
      button.textContent = active ? "Exit presentation" : "Present";
      button.setAttribute("aria-pressed", String(active));
      try {
        if (active && root.requestFullscreen) await root.requestFullscreen();
        else if (!active && document2.fullscreenElement) await document2.exitFullscreen();
      } catch {
      }
      if (active) showChapter(0);
      else fit();
    }
    listen(document2, "fullscreenchange", () => {
      if (!document2.fullscreenElement && root.dataset.present === "true") resetPresentation();
    });
    const actions = {
      pan: () => setMode("interact"),
      comment: () => setMode("comment"),
      "zoom-in": () => zoom(camera.scale * 1.2),
      "zoom-out": () => zoom(camera.scale / 1.2),
      fit: () => fit(),
      width: () => fit("width"),
      actual: () => zoom(1),
      outline: () => setOutline(root.dataset.outlineOpen !== "true"),
      review: () => setRail(root.dataset.planrRailOpen !== "true"),
      present
    };
    actions["previous-chapter"] = () => showChapter(presentationIndex - 1);
    actions["next-chapter"] = () => showChapter(presentationIndex + 1);
    actions.connections = () => {
      connectionFocus = !connectionFocus;
      updateSelection();
      status(
        connectionFocus ? "Direct connections highlighted · Click again to show all" : "Showing the complete diagram"
      );
    };
    actions["toggle-group"] = () => {
      const item = config.items[selectedIndex];
      if (item?.kind !== "Group") return;
      if (collapsedGroups.has(item.id)) collapsedGroups.delete(item.id);
      else collapsedGroups.add(item.id);
      applyGroupVisibility();
      selectItem(selectedIndex, { focus: false });
      status(
        collapsedGroups.has(item.id) ? `${item.label} details collapsed` : `${item.label} details expanded`
      );
    };
    actions["close-details"] = () => {
      selectedIndex = -1;
      connectionFocus = false;
      updateSelection();
      root.querySelector("[data-element-details]").hidden = true;
      root.querySelectorAll("[aria-current=true]").forEach((element) => element.removeAttribute("aria-current"));
    };
    actions["comment-element"] = () => {
      const item = config.items[selectedIndex];
      if (!item) return;
      const rect = elementBounds(item.id);
      if (!rect) return;
      annotations.openComposer({
        artifactId: config.artifact.id,
        viewport: config.artifact.viewport,
        variant: "diagram",
        region: {
          x: (rect.x + rect.width / 2) / width,
          y: (rect.y + rect.height / 2) / height,
          w: 0,
          h: 0
        }
      });
    };
    listen(root, "click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button) actions[button.dataset.action]?.();
      const item = event.target.closest("[data-item-index]");
      if (item) selectItem(Number(item.dataset.itemIndex));
      if (event.target.closest("[data-planr-close-feedback]")) {
        setRail(false);
        root.querySelector("[data-action=review]").focus();
      }
      if (!event.target.closest(".diagram-export"))
        root.querySelector(".diagram-export").open = false;
    });
    function point(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    function resetGesture() {
      pointers.clear();
      gesture = null;
      root.querySelector("[data-selection]").hidden = true;
      delete canvas.dataset.dragging;
    }
    function beginPinch() {
      const [a, b] = [...pointers.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = {
        type: "pinch",
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale: camera.scale,
        diagramX: (center.x - camera.x) / camera.scale,
        diagramY: (center.y - camera.y) / camera.scale
      };
      root.querySelector("[data-selection]").hidden = true;
    }
    listen(canvas, "pointerdown", (event) => {
      if (event.target.closest("button,a,input,.diagram-canvas-tools,.planr-pin") || ![0, 1].includes(event.button))
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
      const comment = state.reviewMode === "comment" && !space && event.button === 0 && event.target.closest(".diagram-scene");
      gesture = {
        type: comment ? "comment" : "pan",
        start: p,
        x: camera.x,
        y: camera.y,
        client: { x: event.clientX, y: event.clientY },
        item: hitItem((p.x - camera.x) / camera.scale, (p.y - camera.y) / camera.scale)
      };
      if (!comment) canvas.dataset.dragging = "true";
    });
    listen(canvas, "pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, point(event));
      if (!gesture) return;
      if (gesture.type === "pinch" && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        camera.scale = Math.max(
          0.04,
          Math.min(4, gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance)
        );
        camera.x = (a.x + b.x) / 2 - gesture.diagramX * camera.scale;
        camera.y = (a.y + b.y) / 2 - gesture.diagramY * camera.scale;
        camera.fit = null;
        paint();
        return;
      }
      const p = point(event);
      if (gesture.type === "pan") {
        camera.fit = null;
        camera.x = gesture.x + p.x - gesture.start.x;
        camera.y = gesture.y + p.y - gesture.start.y;
        paint();
      }
      if (gesture.type === "comment") {
        const region = clientSelectionToNormalized(surface.getBoundingClientRect(), gesture.client, {
          x: event.clientX,
          y: event.clientY
        });
        const selection = root.querySelector("[data-selection]");
        selection.hidden = false;
        Object.assign(selection.style, {
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.w * 100}%`,
          height: `${region.h * 100}%`
        });
      }
    });
    listen(canvas, "pointerup", (event) => {
      if (!pointers.has(event.pointerId)) return;
      if (gesture?.type === "pan" && gesture.item && !space && Math.hypot(event.clientX - gesture.client.x, event.clientY - gesture.client.y) < 4) {
        selectItem(gesture.item.index, { focus: false });
        if (window.innerWidth <= 700) setOutline(true);
      }
      if (gesture?.type === "comment" && pointers.size === 1) {
        const region = clientSelectionToNormalized(surface.getBoundingClientRect(), gesture.client, {
          x: event.clientX,
          y: event.clientY
        });
        annotations.openComposer({
          artifactId: config.artifact.id,
          viewport: config.artifact.viewport,
          variant: "diagram",
          region
        });
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      resetGesture();
    });
    listen(canvas, "pointercancel", resetGesture);
    listen(canvas, "lostpointercapture", (event) => {
      if (pointers.has(event.pointerId)) resetGesture();
    });
    listen(window, "blur", () => {
      space = false;
      resetGesture();
    });
    listen(
      canvas,
      "wheel",
      (event) => {
        if (event.target.closest(".diagram-canvas-tools")) return;
        event.preventDefault();
        const p = point(event);
        const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
        if (event.ctrlKey || event.metaKey)
          zoom(camera.scale * Math.exp(-event.deltaY * units * 4e-3), p.x, p.y);
        else {
          camera.fit = null;
          camera.x -= (event.shiftKey ? event.deltaY : event.deltaX) * units;
          camera.y -= (event.shiftKey ? 0 : event.deltaY) * units;
          paint();
        }
      },
      { passive: false }
    );
    listen(document2, "keydown", (event) => {
      if (event.target.closest(
        "input,textarea,select,[contenteditable=true],.planr-annotation-composer"
      ) || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const key = event.key.toLowerCase();
      if (root.dataset.present === "true") {
        const chapterKey = {
          arrowleft: presentationIndex - 1,
          pageup: presentationIndex - 1,
          arrowright: presentationIndex + 1,
          pagedown: presentationIndex + 1,
          home: 0,
          end: chapters.length - 1
        }[key];
        if (chapterKey !== void 0) {
          event.preventDefault();
          showChapter(chapterKey);
          return;
        }
      }
      if (key === " " && !event.target.closest("button,a,summary,[role=button]")) {
        event.preventDefault();
        space = true;
      }
      const keys = {
        f: "fit",
        0: "fit",
        w: "width",
        1: "actual",
        "+": "zoom-in",
        "=": "zoom-in",
        "-": "zoom-out",
        c: "comment",
        v: "pan",
        n: "outline",
        p: "present"
      };
      if (keys[key]) {
        event.preventDefault();
        actions[keys[key]]();
      }
      if (key === "escape") {
        resetGesture();
        setMode("interact");
        root.querySelector(".diagram-export").open = false;
        if (root.dataset.present === "true") void present();
      }
      if (document2.activeElement === canvas && key.startsWith("arrow")) {
        event.preventDefault();
        camera.fit = null;
        camera.x += key === "arrowleft" ? 60 : key === "arrowright" ? -60 : 0;
        camera.y += key === "arrowup" ? 60 : key === "arrowdown" ? -60 : 0;
        paint();
      }
    });
    listen(document2, "keyup", (event) => {
      if (event.key === " ") space = false;
    });
    let lastWidth = canvas.clientWidth, lastHeight = canvas.clientHeight;
    const resize = new window.ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
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
      }
    };
    window.__openPlanrDiagramStudio = api;
    root.dataset.ready = "true";
    return api;
  }
  if (typeof document !== "undefined") mountDiagramStudio();
})();
