// biome-ignore-all lint/complexity/useArrowFunction: replacement methods stay functions; an arrow has no prototype and fails `new` with a different error, which frame code can observe.
// First code in every artifact frame: removes network, storage, navigation and clipboard
// APIs, then answers the review shell over postMessage. Bundled into
// lib/artifact/ui/generated/sandbox-guards.mjs; bridge.mjs replaces each __PLANR_SANDBOX_*__
// identifier with a per-frame value. The CSP and sandbox stay the boundary.
(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the bundled guard runs as a classic script, where the directive applies.
  'use strict';
  const injectedScript = document.currentScript;
  injectedScript?.remove();
  const contract = __PLANR_SANDBOX_CONTRACT__;
  __PLANR_SANDBOX_BRIDGE_TOOLS__;
  const inspectionTools = createArtifactBridgeTools(document, globalThis);
  const postToParent = parent.postMessage.bind(parent);
  const elementFromPoint = document.elementFromPoint.bind(document);
  const queryAll = document.querySelectorAll.bind(document);
  const elementClosest = Element.prototype.closest;
  const elementGetAttribute = Element.prototype.getAttribute;
  const elementSetAttribute = Element.prototype.setAttribute;
  const elementRect = Element.prototype.getBoundingClientRect;
  const nativeCloneNode = Node.prototype.cloneNode;
  const nativeAppendChild = Node.prototype.appendChild;
  const nativeCreateElement = Document.prototype.createElement;
  const nativeGetComputedStyle = globalThis.getComputedStyle.bind(globalThis);
  const nativeSerializeToString = XMLSerializer.prototype.serializeToString;
  const NativeImage = globalThis.Image;
  const nativeExecCommand = Document.prototype.execCommand;
  const nativeDocumentWrite = Document.prototype.write;
  const nativeDocumentWriteln = Document.prototype.writeln;
  const NativeWorker = globalThis.Worker;
  const NativeSharedWorker = globalThis.SharedWorker;
  const NativeBlob = globalThis.Blob;
  const NativeResizeObserver = globalThis.ResizeObserver;
  const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
  const workerGuard = __PLANR_SANDBOX_WORKER_GUARD__;
  const blocked = () => new DOMException('Blocked by OpenPlanr artifact sandbox', 'SecurityError');
  const replace = (owner, key, value) => {
    try {
      Object.defineProperty(owner, key, { value, writable: false, configurable: false });
    } catch {
      try {
        owner[key] = value;
      } catch {
        // Neither configurable nor writable: skip it; the CSP still applies.
      }
    }
  };
  const reject = () => Promise.reject(blocked());
  const workerUrls = new Set();
  let liveWorkerCount = 0;
  replace(globalThis, 'fetch', reject);
  for (const key of [
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'WebTransport',
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
  ]) {
    if (key in globalThis)
      replace(
        globalThis,
        key,
        class {
          constructor() {
            throw blocked();
          }
        },
      );
  }
  replace(globalThis, 'open', () => null);
  try {
    replace(Navigator.prototype, 'sendBeacon', () => false);
  } catch {
    // Locked by this engine; connect-src 'none' still blocks the beacon.
  }
  try {
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      get() {
        throw blocked();
      },
      configurable: false,
    });
  } catch {
    // Locked by this engine; an opaque-origin frame cannot register a service worker.
  }
  try {
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      get() {
        throw blocked();
      },
      configurable: false,
    });
  } catch {
    // Locked by this engine; the opaque-origin frame has no clipboard permission.
  }
  try {
    if ('share' in Navigator.prototype) replace(Navigator.prototype, 'share', reject);
  } catch {
    // Locked by this engine; the opaque-origin frame has no Web Share permission.
  }
  try {
    if (typeof StorageManager === 'function' && 'getDirectory' in StorageManager.prototype)
      replace(StorageManager.prototype, 'getDirectory', reject);
  } catch {
    // An unusual StorageManager: skip it; the opaque-origin frame has no persistent storage.
  }
  try {
    if (typeof StorageManager === 'function' && 'persist' in StorageManager.prototype)
      replace(StorageManager.prototype, 'persist', reject);
  } catch {
    // An unusual StorageManager: skip it; the opaque-origin frame has no persistent storage.
  }
  for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore']) {
    try {
      Object.defineProperty(globalThis, key, {
        get() {
          throw blocked();
        },
        configurable: false,
      });
    } catch {
      // Already non-configurable here; opaque-origin storage access throws on its own.
    }
  }
  try {
    replace(HTMLFormElement.prototype, 'submit', function () {
      throw blocked();
    });
    replace(HTMLFormElement.prototype, 'requestSubmit', function () {
      throw blocked();
    });
  } catch {
    // Locked by this engine; form-action 'none' still blocks submission.
  }
  try {
    replace(Document.prototype, 'open', function () {
      throw blocked();
    });
  } catch {
    // Locked by this engine; this is defence in depth and the CSP stays the boundary.
  }
  try {
    if (typeof nativeDocumentWrite === 'function')
      replace(Document.prototype, 'write', function (...values) {
        if (this.readyState !== 'loading') throw blocked();
        return nativeDocumentWrite.apply(this, values);
      });
  } catch {
    // Locked by this engine; this is defence in depth and the CSP stays the boundary.
  }
  try {
    if (typeof nativeDocumentWriteln === 'function')
      replace(Document.prototype, 'writeln', function (...values) {
        if (this.readyState !== 'loading') throw blocked();
        return nativeDocumentWriteln.apply(this, values);
      });
  } catch {
    // Locked by this engine; this is defence in depth and the CSP stays the boundary.
  }
  try {
    if (typeof nativeExecCommand === 'function')
      replace(Document.prototype, 'execCommand', function (command, ...args) {
        if (['copy', 'cut', 'paste'].includes(String(command).toLowerCase())) throw blocked();
        return nativeExecCommand.call(this, command, ...args);
      });
  } catch {
    // Locked by this engine; the capture-phase clipboard listeners still cancel the event.
  }
  const workerWrapper = (url, options, Shared) => {
    if (liveWorkerCount >= 32) throw blocked();
    const source = String(url);
    if (!/^(?:blob:|data:)/i.test(source)) throw blocked();
    const module = options && options.type === 'module';
    if (module) throw blocked();
    const loader = '__planrLoadWorker(' + JSON.stringify(source) + ')';
    const body =
      '(function(__planrLoadWorker){' +
      workerGuard +
      ';' +
      loader +
      '})(globalThis.importScripts.bind(globalThis));';
    const wrapper = nativeCreateObjectURL(new NativeBlob([body], { type: 'text/javascript' }));
    workerUrls.add(wrapper);
    liveWorkerCount += 1;
    try {
      const instance = Shared
        ? new NativeSharedWorker(wrapper, options)
        : new NativeWorker(wrapper, options);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        liveWorkerCount = Math.max(0, liveWorkerCount - 1);
        workerUrls.delete(wrapper);
        nativeRevokeObjectURL(wrapper);
      };
      if (!Shared && typeof instance.terminate === 'function') {
        const terminate = instance.terminate.bind(instance);
        replace(instance, 'terminate', () => {
          release();
          return terminate();
        });
      }
      if (Shared && instance.port && typeof instance.port.close === 'function') {
        const close = instance.port.close.bind(instance.port);
        replace(instance.port, 'close', () => {
          release();
          return close();
        });
      }
      return instance;
    } catch (error) {
      liveWorkerCount = Math.max(0, liveWorkerCount - 1);
      workerUrls.delete(wrapper);
      nativeRevokeObjectURL(wrapper);
      throw error;
    }
  };
  const installWorker = (name, Native, Shared) => {
    if (typeof Native !== 'function') return;
    const Wrapped = function (url, options) {
      return workerWrapper(url, options, Shared);
    };
    try {
      Object.defineProperty(Wrapped, 'name', { value: name });
      Object.setPrototypeOf(Wrapped, Native);
      Object.defineProperty(Wrapped, 'prototype', { value: Native.prototype });
    } catch {
      // Cosmetic: the wrapper works without the native name and prototype chain.
    }
    replace(globalThis, name, Wrapped);
  };
  try {
    installWorker('Worker', NativeWorker, false);
  } catch {
    // Absent or locked in this engine; workers still inherit the frame CSP.
  }
  try {
    installWorker('SharedWorker', NativeSharedWorker, true);
  } catch {
    // Absent or locked in this engine; workers still inherit the frame CSP.
  }
  try {
    replace(Location.prototype, 'assign', function () {
      throw blocked();
    });
    replace(Location.prototype, 'replace', function () {
      throw blocked();
    });
  } catch {
    // Location members are unforgeable in some engines; the shell's navigation recovery still applies.
  }
  try {
    navigation?.addEventListener('navigate', (event) => {
      if (event.cancelable) event.preventDefault();
    });
  } catch {
    // Engines without the Navigation API throw a ReferenceError here.
  }
  addEventListener(
    'click',
    (event) => {
      if (event.target?.closest?.('a,[formaction]')) event.preventDefault();
    },
    true,
  );
  addEventListener('submit', (event) => event.preventDefault(), true);
  for (const type of ['copy', 'cut', 'paste'])
    addEventListener(
      type,
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  addEventListener(
    'pagehide',
    () => {
      for (const url of workerUrls) nativeRevokeObjectURL(url);
      workerUrls.clear();
      liveWorkerCount = 0;
    },
    { once: true },
  );

  const plain = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  };
  const own = (value, key) => {
    const descriptor = plain(value) ? Object.getOwnPropertyDescriptor(value, key) : null;
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  const exact = (value, keys) =>
    plain(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
  const validText = (value, max) =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  const validId = (value) =>
    validText(value, 512) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value);
  const validScreen = (value) =>
    // biome-ignore lint/suspicious/noControlCharactersInRegex: a screen name must not contain control characters.
    typeof value === 'string' && /^[^\u0000-\u001f\u007f]{1,128}$/.test(value);
  const validRequestId = (value) =>
    validText(value, 128) && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);
  const validBase = (data, type, keys) =>
    exact(data, keys) &&
    own(data, 'channel') === contract.channel &&
    own(data, 'schemaVersion') === contract.schemaVersion &&
    own(data, 'type') === type &&
    own(data, 'artifactId') === contract.artifactId &&
    validRequestId(own(data, 'requestId'));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const closest = (element, selector) => (element ? elementClosest.call(element, selector) : null);
  const attribute = (element, name) => (element ? elementGetAttribute.call(element, name) : null);
  const screenFor = (element) =>
    attribute(closest(element, '[data-planr-screen]'), 'data-planr-screen') || undefined;
  const anchorFor = (element) => {
    const anchor = closest(element, '[data-planr-id]');
    if (!anchor) return null;
    const planrId = attribute(anchor, 'data-planr-id');
    if (!validText(planrId, 512)) return null;
    const rect = elementRect.call(anchor);
    const width = Math.max(1, innerWidth),
      height = Math.max(1, innerHeight);
    const x = clamp(rect.left, 0, width),
      y = clamp(rect.top, 0, height);
    const right = clamp(rect.right, 0, width),
      bottom = clamp(rect.bottom, 0, height);
    const screen = screenFor(anchor);
    return {
      planrId,
      ...(screen === undefined ? {} : { screen }),
      rect: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) },
      viewport: { width, height },
    };
  };
  const findById = (id, screen) => {
    for (const element of queryAll('[data-planr-id]')) {
      if (attribute(element, 'data-planr-id') !== id) continue;
      if (screen !== undefined && screenFor(element) !== screen) continue;
      return element;
    }
    return null;
  };
  const exportTarget = (target) => {
    if (target === 'full') return { node: document.body, label: 'full' };
    let node = elementFromPoint(innerWidth / 2, innerHeight / 2);
    node =
      closest(node, '[data-planr-id],[data-dc-slot],[data-planr-screen],section[id]') ||
      document.body;
    const label =
      attribute(node, 'data-planr-screen') ||
      attribute(node, 'data-dc-slot') ||
      attribute(node, 'data-planr-id') ||
      attribute(node, 'id') ||
      'screen';
    return { node, label };
  };
  const exportPng = async (target) => {
    const selected = exportTarget(target),
      node = selected.node;
    const width = Math.ceil(
      Math.max(node.scrollWidth || 0, node.clientWidth || 0, elementRect.call(node).width || 0),
    );
    const height = Math.ceil(
      Math.max(node.scrollHeight || 0, node.clientHeight || 0, elementRect.call(node).height || 0),
    );
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > __PLANR_SANDBOX_EXPORT_MAX_EDGE__ ||
      height > __PLANR_SANDBOX_EXPORT_MAX_EDGE__ ||
      width * height > 40000000
    )
      throw new Error('export dimensions are unavailable or too large');
    let count = 0;
    const cloneStyled = (src) => {
      if (++count > 10000) throw new Error('export node limit exceeded');
      if (src.nodeType === 8 || (src.nodeType === 1 && src.tagName === 'SCRIPT'))
        return document.createTextNode('');
      const dst = nativeCloneNode.call(src, false);
      if (src.nodeType === 1) {
        const style = nativeGetComputedStyle(src);
        let css = '';
        for (let index = 0; index < style.length; index += 1) {
          const name = style[index];
          css += name + ':' + style.getPropertyValue(name) + ';';
        }
        elementSetAttribute.call(dst, 'style', css + 'animation:none;transition:none;');
        if (src.tagName === 'CANVAS') {
          try {
            const image = nativeCreateElement.call(document, 'img');
            image.src = src.toDataURL('image/png');
            elementSetAttribute.call(image, 'style', css);
            return image;
          } catch {
            // A tainted canvas refuses toDataURL: export the blank clone instead.
          }
        }
      }
      for (let child = src.firstChild; child; child = child.nextSibling)
        nativeAppendChild.call(dst, cloneStyled(child));
      return dst;
    };
    await (document.fonts?.ready?.catch(() => {
      // A failed font load must not block the export.
    }) ?? Promise.resolve());
    const clone = cloneStyled(node);
    if (clone.nodeType === 1) {
      elementSetAttribute.call(clone, 'xmlns', 'http://www.w3.org/1999/xhtml');
      clone.style.boxShadow = 'none';
      clone.style.borderRadius = '0';
    }
    const markup = nativeSerializeToString.call(new XMLSerializer(), clone);
    if (markup.length > 10 * 1024 * 1024) throw new Error('export markup limit exceeded');
    const scale = clamp(
      Math.floor(__PLANR_SANDBOX_EXPORT_MAX_EDGE__ / Math.max(width, height)) || 1,
      1,
      3,
    );
    const outputWidth = width * scale,
      outputHeight = height * scale;
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
    const image = new NativeImage();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('render failed'));
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    const canvas = nativeCreateElement.call(document, 'canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    canvas.getContext('2d').drawImage(image, 0, 0, outputWidth, outputHeight);
    const dataUrl = canvas.toDataURL('image/png');
    if (typeof dataUrl !== 'string' || dataUrl.length > __PLANR_SANDBOX_EXPORT_MAX_DATA_URL__)
      throw new Error('export PNG limit exceeded');
    return {
      dataUrl,
      width: outputWidth,
      height: outputHeight,
      label: String(selected.label).slice(0, 128),
    };
  };
  const send = (type, requestId, anchor) => {
    const message = {
      channel: contract.channel,
      schemaVersion: contract.schemaVersion,
      type,
      nonce: contract.nonce,
      artifactId: contract.artifactId,
    };
    if (requestId) message.requestId = requestId;
    if (anchor) message.anchor = anchor;
    postToParent(message, contract.parentOrigin === 'null' ? '*' : contract.parentOrigin);
  };
  const sendExport = (type, requestId, value) => {
    const message = {
      channel: contract.channel,
      schemaVersion: contract.schemaVersion,
      type,
      nonce: contract.nonce,
      artifactId: contract.artifactId,
      requestId,
    };
    if (type === 'export.result') Object.assign(message, value);
    else message.reason = String(value || 'export failed').slice(0, 256);
    postToParent(message, contract.parentOrigin === 'null' ? '*' : contract.parentOrigin);
  };
  const viewportGestures = createArtifactViewportGestures(window, (type, value) =>
    postToParent(
      {
        channel: contract.channel,
        schemaVersion: contract.schemaVersion,
        type,
        nonce: contract.nonce,
        artifactId: contract.artifactId,
        ...value,
      },
      contract.parentOrigin === 'null' ? '*' : contract.parentOrigin,
    ),
  );
  let lastLayout = '';
  let layoutTimer = 0;
  const measureLayout = () => {
    layoutTimer = 0;
    const root = document.documentElement,
      body = document.body;
    const width = Math.ceil(
      Math.max(
        root?.scrollWidth || 0,
        root?.clientWidth || 0,
        body?.scrollWidth || 0,
        body?.clientWidth || 0,
        innerWidth || 0,
      ),
    );
    const height = Math.ceil(
      Math.max(
        root?.scrollHeight || 0,
        root?.clientHeight || 0,
        body?.scrollHeight || 0,
        body?.clientHeight || 0,
        innerHeight || 0,
      ),
    );
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > __PLANR_SANDBOX_LAYOUT_MAX_WIDTH__ ||
      height > __PLANR_SANDBOX_LAYOUT_MAX_HEIGHT__
    )
      return;
    const signature = width + 'x' + height;
    if (signature === lastLayout) return;
    lastLayout = signature;
    postToParent(
      {
        channel: contract.channel,
        schemaVersion: contract.schemaVersion,
        type: 'layout.measurement',
        nonce: contract.nonce,
        artifactId: contract.artifactId,
        layout: { width, height },
      },
      contract.parentOrigin === 'null' ? '*' : contract.parentOrigin,
    );
  };
  const scheduleLayout = () => {
    if (layoutTimer) return;
    layoutTimer = setTimeout(measureLayout, 80);
  };
  try {
    if (typeof NativeResizeObserver === 'function') {
      const observer = new NativeResizeObserver(scheduleLayout);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
    }
  } catch {
    // Without a ResizeObserver, layout is still measured when the shell challenges the frame.
  }
  let windowStart = performance.now(),
    messageCount = 0;
  addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== contract.parentOrigin) return;
    const now = performance.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      messageCount = 0;
    }
    if (++messageCount > 60) return;
    const data = event.data;
    if (
      validBase(data, 'bridge.challenge', [
        'channel',
        'schemaVersion',
        'type',
        'artifactId',
        'requestId',
      ])
    ) {
      send('bridge.challenge-ack', data.requestId);
      scheduleLayout();
      return;
    }
    if (
      validBase(data, 'viewport.gestures', [
        'channel',
        'schemaVersion',
        'type',
        'artifactId',
        'requestId',
        'enabled',
      ]) &&
      typeof own(data, 'enabled') === 'boolean'
    ) {
      viewportGestures.setEnabled(own(data, 'enabled'));
      return;
    }
    const toolReply = (type, value = {}) =>
      postToParent(
        {
          channel: contract.channel,
          schemaVersion: contract.schemaVersion,
          type,
          nonce: contract.nonce,
          artifactId: contract.artifactId,
          requestId: data.requestId,
          ...value,
        },
        contract.parentOrigin === 'null' ? '*' : contract.parentOrigin,
      );
    if (
      validBase(data, 'thumbnail.request', [
        'channel',
        'schemaVersion',
        'type',
        'artifactId',
        'requestId',
      ])
    ) {
      inspectionTools
        .thumbnail()
        .then((value) => toolReply('thumbnail.result', value))
        .catch(() => toolReply('thumbnail.error', { reason: 'Thumbnail capture unavailable.' }));
      return;
    }
    if (
      validBase(data, 'inspect.point', [
        'channel',
        'schemaVersion',
        'type',
        'artifactId',
        'requestId',
        'x',
        'y',
      ])
    ) {
      const inspection = inspectionTools.inspectAt(own(data, 'x'), own(data, 'y'));
      toolReply(inspection ? 'inspect.result' : 'inspect.miss', inspection ? { inspection } : {});
      return;
    }
    const inspectionKeys =
      own(data, 'screen') === undefined
        ? ['channel', 'schemaVersion', 'type', 'artifactId', 'requestId', 'planrId']
        : ['channel', 'schemaVersion', 'type', 'artifactId', 'requestId', 'planrId', 'screen'];
    if (validBase(data, 'inspect.anchor', inspectionKeys)) {
      const inspection = inspectionTools.inspect({
        planrId: own(data, 'planrId'),
        ...(own(data, 'screen') === undefined ? {} : { screen: own(data, 'screen') }),
      });
      toolReply(inspection ? 'inspect.result' : 'inspect.miss', inspection ? { inspection } : {});
      return;
    }
    if (
      validBase(data, 'export.request', [
        'channel',
        'schemaVersion',
        'type',
        'artifactId',
        'requestId',
        'target',
      ]) &&
      ['screen', 'full'].includes(own(data, 'target'))
    ) {
      exportPng(own(data, 'target'))
        .then((value) => sendExport('export.result', data.requestId, value))
        .catch((error) => sendExport('export.error', data.requestId, error?.message));
      return;
    }
    if (
      validBase(data, 'anchor.hit-test', [
        'channel',
        'schemaVersion',
        'type',
        'artifactId',
        'requestId',
        'x',
        'y',
      ])
    ) {
      const x = own(data, 'x'),
        y = own(data, 'y');
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > innerWidth ||
        y > innerHeight
      )
        return;
      const anchor = anchorFor(elementFromPoint(x, y));
      send(anchor ? 'anchor.result' : 'anchor.miss', data.requestId, anchor);
      return;
    }
    const resolveKeys =
      own(data, 'screen') === undefined
        ? ['channel', 'schemaVersion', 'type', 'artifactId', 'requestId', 'planrId']
        : ['channel', 'schemaVersion', 'type', 'artifactId', 'requestId', 'planrId', 'screen'];
    if (validBase(data, 'anchor.resolve', resolveKeys)) {
      const planrId = own(data, 'planrId'),
        screen = own(data, 'screen');
      if (!validId(planrId) || (screen !== undefined && !validScreen(screen))) return;
      const anchor = anchorFor(findById(planrId, screen));
      send(anchor ? 'anchor.result' : 'anchor.miss', data.requestId, anchor);
    }
  });
  const ready = () => send('bridge.ready');
  if (document.readyState === 'loading')
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        ready();
        scheduleLayout();
      },
      { once: true },
    );
  else
    queueMicrotask(() => {
      ready();
      scheduleLayout();
    });
})();
