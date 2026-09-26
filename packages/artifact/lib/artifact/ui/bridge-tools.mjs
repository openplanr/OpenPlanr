/** Browser-safe bounds shared by the local and hosted authenticated bridges. */
export const ARTIFACT_THUMBNAIL_MAX_EDGE = 320;
export const ARTIFACT_THUMBNAIL_MAX_DATA_URL = 256 * 1024;
export const ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA = 1000;
export const ARTIFACT_VIEWPORT_PAN_MAX_DELTA = 1000;

/** Validate only after the sender's source, origin, nonce and identity are checked. */
export function normalizeArtifactViewportZoom(value, viewport) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const keys = ['x', 'y', 'deltaY'];
  if (
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    !keys.every(
      (key) =>
        Object.hasOwn(descriptors[key], 'value') &&
        typeof descriptors[key].value === 'number' &&
        Number.isFinite(descriptors[key].value),
    )
  )
    return null;
  const { x, y, deltaY } = value;
  if (
    !Number.isFinite(viewport?.width) ||
    !Number.isFinite(viewport?.height) ||
    viewport.width < 1 ||
    viewport.height < 1 ||
    viewport.width > 16384 ||
    viewport.height > 16384 ||
    x < 0 ||
    y < 0 ||
    x > viewport.width ||
    y > viewport.height ||
    deltaY === 0 ||
    Math.abs(deltaY) > ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA
  )
    return null;
  return Object.freeze({ x, y, deltaY });
}

export function normalizeArtifactViewportPan(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return null;
  const keys = ['deltaX', 'deltaY'];
  if (
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    !keys.every(
      (key) =>
        Object.hasOwn(descriptors[key], 'value') &&
        typeof descriptors[key].value === 'number' &&
        Number.isFinite(descriptors[key].value),
    )
  )
    return null;
  const { deltaX, deltaY } = value;
  if (
    (!deltaX && !deltaY) ||
    Math.abs(deltaX) > ARTIFACT_VIEWPORT_PAN_MAX_DELTA ||
    Math.abs(deltaY) > ARTIFACT_VIEWPORT_PAN_MAX_DELTA
  )
    return null;
  return Object.freeze({ deltaX, deltaY });
}

/** Opt-in host camera gestures; install before product scripts, without exposing the emitter. */
export function createArtifactViewportGestures(window, emit) {
  const add = window.addEventListener.bind(window),
    remove = window.removeEventListener.bind(window);
  const schedule = window.setTimeout.bind(window),
    cancel = window.clearTimeout.bind(window);
  const prevent = window.Event.prototype.preventDefault,
    stop = window.Event.prototype.stopImmediatePropagation;
  const getter = (prototype, name) => Object.getOwnPropertyDescriptor(prototype, name)?.get;
  const native = {
    x: getter(window.MouseEvent.prototype, 'clientX'),
    y: getter(window.MouseEvent.prototype, 'clientY'),
    ctrl: getter(window.MouseEvent.prototype, 'ctrlKey'),
    meta: getter(window.MouseEvent.prototype, 'metaKey'),
    shift: getter(window.MouseEvent.prototype, 'shiftKey'),
    deltaX: getter(window.WheelEvent.prototype, 'deltaX'),
    deltaY: getter(window.WheelEvent.prototype, 'deltaY'),
    mode: getter(window.WheelEvent.prototype, 'deltaMode'),
  };
  let enabled = false,
    disposed = false,
    timer = 0,
    pending = null,
    pendingType = '';
  const clear = () => {
    if (timer) cancel(timer);
    timer = 0;
    pending = null;
    pendingType = '';
  };
  const flush = () => {
    timer = 0;
    const value = pending;
    const type = pendingType;
    pending = null;
    pendingType = '';
    if (enabled && !disposed && value) emit(type, value);
  };
  const wheel = (event) => {
    if (!enabled || disposed || !event.isTrusted || !event.cancelable) return;
    let x, y, deltaX, deltaY, mode, zooming, shift;
    try {
      x = native.x.call(event);
      y = native.y.call(event);
      mode = native.mode.call(event);
      zooming = native.ctrl.call(event) || native.meta.call(event);
      shift = native.shift.call(event);
      deltaX = native.deltaX.call(event);
      deltaY = native.deltaY.call(event);
    } catch {
      return;
    }
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const scaleX = mode === 1 ? 16 : mode === 2 ? window.innerWidth : 1;
    const scaleY = mode === 1 ? 16 : mode === 2 ? window.innerHeight : 1;
    deltaX *= scaleX;
    deltaY *= scaleY;
    let type;
    let value;
    if (zooming) {
      type = 'viewport.zoom';
      deltaY = Math.max(
        -ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA,
        Math.min(ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA, deltaY),
      );
      value = normalizeArtifactViewportZoom(
        { x, y, deltaY },
        { width: window.innerWidth, height: window.innerHeight },
      );
    } else {
      type = 'viewport.pan';
      if (shift && !deltaX) {
        deltaX = deltaY;
        deltaY = 0;
      }
      deltaX = Math.max(
        -ARTIFACT_VIEWPORT_PAN_MAX_DELTA,
        Math.min(ARTIFACT_VIEWPORT_PAN_MAX_DELTA, deltaX),
      );
      deltaY = Math.max(
        -ARTIFACT_VIEWPORT_PAN_MAX_DELTA,
        Math.min(ARTIFACT_VIEWPORT_PAN_MAX_DELTA, deltaY),
      );
      value = normalizeArtifactViewportPan({ deltaX, deltaY });
    }
    if (!value) return;
    prevent.call(event);
    stop.call(event);
    if (pendingType && pendingType !== type) flush();
    pendingType = type;
    pending =
      type === 'viewport.zoom'
        ? {
            ...value,
            deltaY: Math.max(
              -ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA,
              Math.min(ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA, (pending?.deltaY || 0) + deltaY),
            ),
          }
        : {
            deltaX: Math.max(
              -ARTIFACT_VIEWPORT_PAN_MAX_DELTA,
              Math.min(ARTIFACT_VIEWPORT_PAN_MAX_DELTA, (pending?.deltaX || 0) + deltaX),
            ),
            deltaY: Math.max(
              -ARTIFACT_VIEWPORT_PAN_MAX_DELTA,
              Math.min(ARTIFACT_VIEWPORT_PAN_MAX_DELTA, (pending?.deltaY || 0) + deltaY),
            ),
          };
    if (!timer) timer = schedule(flush, 16);
  };
  const destroy = () => {
    disposed = true;
    enabled = false;
    clear();
    remove('wheel', wheel, true);
    remove('pagehide', destroy);
  };
  add('wheel', wheel, { capture: true, passive: false });
  add('pagehide', destroy, { once: true });
  return Object.freeze({
    setEnabled(value) {
      if (disposed || typeof value !== 'boolean') return false;
      enabled = value;
      if (!value) clear();
      return true;
    },
    destroy,
  });
}
export const ARTIFACT_BRIDGE_OPERATION_TIMEOUTS = Object.freeze({
  'inspect.point': 1200,
  'inspect.anchor': 1200,
  'thumbnail.request': 3000,
  'export.request': 8000,
});
export const ARTIFACT_INSPECTION_PROPERTIES = Object.freeze([
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'display',
  'position',
  'gap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border-radius',
  'border-width',
  'border-color',
  'box-sizing',
]);

export function normalizeArtifactInspection(value, viewport) {
  const plain = (entry) =>
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(entry));
  const own = (entry, key) => {
    const descriptor = plain(entry) ? Object.getOwnPropertyDescriptor(entry, key) : null;
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  const exact = (entry, keys) =>
    plain(entry) &&
    Object.keys(entry).length === keys.length &&
    Object.keys(entry).every((key) => keys.includes(key));
  if (!exact(value, ['tagName', 'anchor', 'rect', 'viewport', 'styles', 'accessibility']))
    return null;
  const tagName = own(value, 'tagName');
  const anchor = own(value, 'anchor');
  const rect = own(value, 'rect');
  const size = own(value, 'viewport');
  const styles = own(value, 'styles');
  const accessibility = own(value, 'accessibility');
  if (typeof tagName !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(tagName)) return null;
  if (!exact(size, ['width', 'height']) || !exact(rect, ['x', 'y', 'width', 'height'])) return null;
  if (
    !['width', 'height'].every(
      (key) =>
        Number.isInteger(own(size, key)) &&
        own(size, key) >= 1 &&
        own(size, key) <= 16384 &&
        own(size, key) === viewport?.[key],
    )
  )
    return null;
  if (
    !['x', 'y', 'width', 'height'].every(
      (key) =>
        typeof own(rect, key) === 'number' &&
        Number.isFinite(own(rect, key)) &&
        own(rect, key) >= 0,
    )
  )
    return null;
  if (rect.x + rect.width > size.width || rect.y + rect.height > size.height) return null;
  if (
    anchor !== null &&
    (!exact(anchor, own(anchor, 'screen') === undefined ? ['planrId'] : ['planrId', 'screen']) ||
      typeof own(anchor, 'planrId') !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(anchor.planrId) ||
      (own(anchor, 'screen') !== undefined &&
        (typeof anchor.screen !== 'string' ||
          !/^[^\u0000-\u001f\u007f]{1,128}$/.test(anchor.screen))))
  )
    return null;
  if (
    !exact(styles, ARTIFACT_INSPECTION_PROPERTIES) ||
    !ARTIFACT_INSPECTION_PROPERTIES.every((key) => {
      const text = own(styles, key);
      return (
        typeof text === 'string' &&
        text.length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(text) &&
        !/(?:url\s*\(|https?:|file:)/i.test(text)
      );
    })
  )
    return null;
  if (
    !exact(accessibility, ['role', 'ariaLabel', 'alt', 'tabIndex', 'disabled']) ||
    !['role', 'ariaLabel', 'alt'].every(
      (key) =>
        typeof own(accessibility, key) === 'string' &&
        own(accessibility, key).length <= 256 &&
        !/[\u0000-\u001f\u007f]/.test(own(accessibility, key)),
    ) ||
    !Number.isInteger(own(accessibility, 'tabIndex')) ||
    accessibility.tabIndex < -1 ||
    accessibility.tabIndex > 32767 ||
    typeof own(accessibility, 'disabled') !== 'boolean'
  )
    return null;
  return Object.freeze({
    tagName,
    anchor: anchor === null ? null : Object.freeze({ ...anchor }),
    rect: Object.freeze({ ...rect }),
    viewport: Object.freeze({ ...size }),
    styles: Object.freeze({ ...styles }),
    accessibility: Object.freeze({ ...accessibility }),
  });
}

export function normalizeArtifactThumbnail(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 ||
    !Object.keys(value).every((key) => ['dataUrl', 'width', 'height', 'label'].includes(key)) ||
    !Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
      Object.hasOwn(descriptor, 'value'),
    )
  )
    return null;
  const { dataUrl, width, height, label } = value;
  if (
    typeof dataUrl !== 'string' ||
    dataUrl.length > ARTIFACT_THUMBNAIL_MAX_DATA_URL ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > ARTIFACT_THUMBNAIL_MAX_EDGE ||
    height > ARTIFACT_THUMBNAIL_MAX_EDGE ||
    typeof label !== 'string' ||
    label.length < 1 ||
    label.length > 128
  )
    return null;
  return Object.freeze({ dataUrl, width, height, label });
}

/** Call only after validating message source, origin, nonce, artifact and pending request. */
export function normalizeArtifactBridgeToolResult(requestType, message, viewport) {
  const base = ['channel', 'schemaVersion', 'type', 'nonce', 'artifactId', 'requestId'];
  const exact = (keys) =>
    message &&
    typeof message === 'object' &&
    !Array.isArray(message) &&
    Object.keys(message).length === keys.length &&
    Object.keys(message).every((key) => keys.includes(key)) &&
    Object.values(Object.getOwnPropertyDescriptors(message)).every((descriptor) =>
      Object.hasOwn(descriptor, 'value'),
    );
  if (requestType === 'inspect.point' || requestType === 'inspect.anchor') {
    if (exact(base) && message.type === 'inspect.miss') return { valid: true, value: null };
    if (!exact([...base, 'inspection']) || message.type !== 'inspect.result')
      return { valid: false };
    const value = normalizeArtifactInspection(message.inspection, viewport);
    return value ? { valid: true, value } : { valid: false };
  }
  if (requestType === 'thumbnail.request') {
    if (
      exact([...base, 'reason']) &&
      message.type === 'thumbnail.error' &&
      typeof message.reason === 'string' &&
      message.reason.length <= 256
    )
      return { valid: true, value: null };
    if (
      !exact([...base, 'dataUrl', 'width', 'height', 'label']) ||
      message.type !== 'thumbnail.result'
    )
      return { valid: false };
    const value = normalizeArtifactThumbnail({
      dataUrl: message.dataUrl,
      width: message.width,
      height: message.height,
      label: message.label,
    });
    return value ? { valid: true, value } : { valid: false };
  }
  return { valid: false };
}

/** Instantiate before authored scripts run, so DOM methods cannot be substituted. */
export function createArtifactBridgeTools(document, window) {
  const fromPoint = document.elementFromPoint.bind(document);
  const query = document.querySelectorAll.bind(document);
  const attr = window.Element.prototype.getAttribute;
  const closest = window.Element.prototype.closest;
  const bounds = window.Element.prototype.getBoundingClientRect;
  const computed = window.getComputedStyle.bind(window);
  const cloneNode = window.Node.prototype.cloneNode;
  const append = window.Node.prototype.appendChild;
  const create = document.createElement.bind(document);
  const setAttribute = window.Element.prototype.setAttribute;
  const serialize = window.XMLSerializer.prototype.serializeToString;
  const Image = window.Image;
  const Serializer = window.XMLSerializer;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const get = (element, key) => attr.call(element, key);
  const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(id);
  const screen = (element) => {
    const owner = closest.call(element, '[data-planr-screen]');
    const value = owner && get(owner, 'data-planr-screen');
    return typeof value === 'string' && /^[^\u0000-\u001f\u007f]{1,128}$/.test(value)
      ? value
      : undefined;
  };
  const clean = (value) =>
    String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, 256);
  const inspectElement = (element) => {
    if (!(element instanceof window.Element)) return null;
    const tagName = element.localName;
    if (typeof tagName !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(tagName)) return null;
    const rect = bounds.call(element),
      width = window.innerWidth,
      height = window.innerHeight;
    const x = clamp(rect.left, 0, width),
      y = clamp(rect.top, 0, height);
    const owner = closest.call(element, '[data-planr-id]');
    const planrId = owner && get(owner, 'data-planr-id');
    const anchorScreen = owner && screen(owner);
    const style = computed(element);
    const styles = Object.fromEntries(
      ARTIFACT_INSPECTION_PROPERTIES.map((key) => {
        const value = clean(style.getPropertyValue(key));
        return [key, /(?:url\s*\(|https?:|file:)/i.test(value) ? '' : value];
      }),
    );
    return {
      tagName,
      anchor: validId(planrId)
        ? { planrId, ...(anchorScreen ? { screen: anchorScreen } : {}) }
        : null,
      rect: {
        x,
        y,
        width: Math.max(0, clamp(rect.right, 0, width) - x),
        height: Math.max(0, clamp(rect.bottom, 0, height) - y),
      },
      viewport: { width, height },
      styles,
      accessibility: {
        role: clean(get(element, 'role')),
        ariaLabel: clean(get(element, 'aria-label')),
        alt: clean(get(element, 'alt')),
        tabIndex: clamp(Number(element.tabIndex) || 0, -1, 32767),
        disabled: get(element, 'disabled') !== null || get(element, 'aria-disabled') === 'true',
      },
    };
  };
  let capturing = false;
  return Object.freeze({
    inspectAt(x, y) {
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > window.innerWidth ||
        y > window.innerHeight
      )
        return null;
      return inspectElement(fromPoint(x, y));
    },
    inspect(anchor) {
      if (
        !anchor ||
        !validId(anchor.planrId) ||
        Object.keys(anchor).some((key) => !['planrId', 'screen'].includes(key)) ||
        (anchor.screen !== undefined &&
          (typeof anchor.screen !== 'string' ||
            !/^[^\u0000-\u001f\u007f]{1,128}$/.test(anchor.screen)))
      )
        return null;
      let count = 0;
      for (const element of query('[data-planr-id]')) {
        if (++count > 10000) return null;
        if (
          get(element, 'data-planr-id') === anchor.planrId &&
          (anchor.screen === undefined || screen(element) === anchor.screen)
        )
          return inspectElement(element);
      }
      return null;
    },
    async thumbnail() {
      if (capturing) throw new Error('Thumbnail capture is busy.');
      capturing = true;
      let image;
      try {
        const deadline = Date.now() + 2400;
        const width = window.innerWidth,
          height = window.innerHeight;
        if (
          !Number.isInteger(width) ||
          !Number.isInteger(height) ||
          width < 1 ||
          height < 1 ||
          width > 16384 ||
          height > 16384
        )
          throw new Error('Thumbnail dimensions are unavailable.');
        let count = 0,
          contentSize = 0;
        const cloneStyled = (source) => {
          if (++count > 4000 || Date.now() > deadline)
            throw new Error('Thumbnail capture limit exceeded.');
          if (
            source.nodeType === 8 ||
            (source.nodeType === 1 && ['SCRIPT', 'STYLE', 'LINK', 'META'].includes(source.tagName))
          )
            return document.createTextNode('');
          const target = cloneNode.call(source, false);
          if (source.nodeType === 1) {
            const styles = computed(source);
            let css = '';
            for (let index = 0; index < styles.length; index++) {
              if (index >= 2048 || Date.now() > deadline)
                throw new Error('Thumbnail style limit exceeded.');
              const name = styles[index];
              if (!name.startsWith('--')) css += name + ':' + styles.getPropertyValue(name) + ';';
            }
            contentSize += css.length + (source.textContent?.length || 0);
            if (contentSize > 4 * 1024 * 1024) throw new Error('Thumbnail markup limit exceeded.');
            setAttribute.call(target, 'style', css + 'animation:none;transition:none;');
            // Captures communicate rendered pixels, never live input values or executable markup.
            for (const attribute of [...target.attributes])
              if (/^on/i.test(attribute.name) || ['value', 'srcdoc'].includes(attribute.name))
                target.removeAttribute(attribute.name);
            if (source.tagName === 'INPUT' || source.tagName === 'TEXTAREA') {
              target.value = '';
              target.textContent = '';
            }
            if (source.tagName === 'CANVAS') {
              try {
                const replacement = create('img');
                replacement.src = source.toDataURL('image/png');
                setAttribute.call(replacement, 'style', css);
                return replacement;
              } catch {}
            }
          }
          if (source.nodeType !== 1 || source.tagName !== 'TEXTAREA')
            for (let child = source.firstChild; child; child = child.nextSibling)
              append.call(target, cloneStyled(child));
          return target;
        };
        const clone = cloneStyled(document.documentElement);
        setAttribute.call(clone, 'xmlns', 'http://www.w3.org/1999/xhtml');
        const markup = serialize.call(new Serializer(), clone);
        if (markup.length > 4 * 1024 * 1024) throw new Error('Thumbnail markup limit exceeded.');
        const scale = Math.min(1, ARTIFACT_THUMBNAIL_MAX_EDGE / Math.max(width, height));
        const outputWidth = Math.max(1, Math.round(width * scale)),
          outputHeight = Math.max(1, Math.round(height * scale));
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' +
          outputWidth +
          '" height="' +
          outputHeight +
          '" viewBox="0 0 ' +
          width +
          ' ' +
          height +
          '"><foreignObject width="' +
          width +
          '" height="' +
          height +
          '">' +
          markup +
          '</foreignObject></svg>';
        image = new Image();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Thumbnail capture timed out.')),
            Math.max(1, deadline - Date.now()),
          );
          image.onload = () => {
            clearTimeout(timer);
            resolve();
          };
          image.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Thumbnail rendering unavailable.'));
          };
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
        const canvas = create('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        canvas.getContext('2d').drawImage(image, 0, 0, outputWidth, outputHeight);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > ARTIFACT_THUMBNAIL_MAX_DATA_URL)
          throw new Error('Thumbnail output limit exceeded.');
        return { dataUrl, width: outputWidth, height: outputHeight, label: 'screen' };
      } finally {
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
        capturing = false;
      }
    },
  });
}

/** Used in sandbox bootstraps; also consumable by hosted asset bundlers. */
export function renderArtifactBridgeToolsSource() {
  return `const ARTIFACT_THUMBNAIL_MAX_EDGE=${ARTIFACT_THUMBNAIL_MAX_EDGE};
const ARTIFACT_THUMBNAIL_MAX_DATA_URL=${ARTIFACT_THUMBNAIL_MAX_DATA_URL};
const ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA=${ARTIFACT_VIEWPORT_ZOOM_MAX_DELTA};
const ARTIFACT_VIEWPORT_PAN_MAX_DELTA=${ARTIFACT_VIEWPORT_PAN_MAX_DELTA};
const ARTIFACT_INSPECTION_PROPERTIES=${JSON.stringify(ARTIFACT_INSPECTION_PROPERTIES)};
const ARTIFACT_BRIDGE_OPERATION_TIMEOUTS=${JSON.stringify(ARTIFACT_BRIDGE_OPERATION_TIMEOUTS)};
${normalizeArtifactInspection.toString()}
${normalizeArtifactThumbnail.toString()}
${normalizeArtifactBridgeToolResult.toString()}
${normalizeArtifactViewportZoom.toString()}
${normalizeArtifactViewportPan.toString()}
${createArtifactViewportGestures.toString()}
${createArtifactBridgeTools.toString()}`;
}
