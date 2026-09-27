// The review shell's side of the artifact bridge: loads each frame, authenticates it with a
// challenge and validates its messages. Bundled into
// lib/artifact/ui/generated/sandbox-guards.mjs; bridge.mjs replaces each __PLANR_SANDBOX_*__
// identifier with a per-shell value.
(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the bundled guard runs as a classic script, where the directive applies.
  'use strict';
  const config = __PLANR_SANDBOX_CONFIG__;
  __PLANR_SANDBOX_BRIDGE_TOOLS__;
  const requestId = () =>
    crypto.randomUUID?.() ||
    'request-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const bridgeClient = {
    attach({ artifact, frame, getState }) {
      const pending = new Map();
      let windowStart = performance.now(),
        messageCount = 0;
      let immutableSource = '',
        trustedLoad = false,
        recovering = false,
        navigationAttempts = 0,
        failedClosed = false;
      let inertSource = '';
      let pendingChallenge = null;
      let measuredLayout = null;
      let viewportGesturesEnabled = false,
        disposed = false;
      const syncViewportGestures = () => {
        if (trustedLoad && !disposed)
          frame.contentWindow?.postMessage(
            {
              channel: config.channel,
              schemaVersion: config.schemaVersion,
              type: 'viewport.gestures',
              artifactId: artifact.id,
              requestId: requestId(),
              enabled: viewportGesturesEnabled,
            },
            '*',
          );
      };
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
      const validNumber = (value) => typeof value === 'number' && Number.isFinite(value);
      const originalPointerEvents = frame.style.pointerEvents;
      const originalInert = frame.inert;
      const quarantine = (active) => {
        frame.inert = active ? true : originalInert;
        frame.style.pointerEvents = active ? 'none' : originalPointerEvents;
        if (active) frame.setAttribute('aria-busy', 'true');
        else frame.removeAttribute('aria-busy');
        frame.dataset.planrBridgeTrusted = String(!active);
      };
      frame.setAttribute('csp', config.frameCsp);
      quarantine(true);
      const receive = (event) => {
        if (event.source !== frame.contentWindow || event.origin !== 'null') return;
        const now = performance.now();
        if (now - windowStart > 1000) {
          windowStart = now;
          messageCount = 0;
        }
        if (++messageCount > 120) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        if (
          own(data, 'channel') !== config.channel ||
          own(data, 'schemaVersion') !== config.schemaVersion ||
          own(data, 'nonce') !== config.nonce ||
          own(data, 'artifactId') !== artifact.id
        )
          return;
        const type = own(data, 'type');
        if (type === 'bridge.ready') {
          if (!exact(data, ['channel', 'schemaVersion', 'type', 'nonce', 'artifactId'])) return;
          return;
        }
        if (type === 'bridge.challenge-ack') {
          if (
            !exact(data, [
              'channel',
              'schemaVersion',
              'type',
              'nonce',
              'artifactId',
              'requestId',
            ]) ||
            !validRequestId(own(data, 'requestId')) ||
            !pendingChallenge ||
            own(data, 'requestId') !== pendingChallenge.id
          )
            return;
          clearTimeout(pendingChallenge.timer);
          pendingChallenge = null;
          trustedLoad = true;
          recovering = false;
          quarantine(false);
          syncViewportGestures();
          frame.dispatchEvent(
            new CustomEvent(config.readyEvent, {
              detail: { artifactId: artifact.id, authenticated: true },
            }),
          );
          return;
        }
        if (type === 'viewport.zoom') {
          if (
            !trustedLoad ||
            !viewportGesturesEnabled ||
            disposed ||
            !exact(data, [
              'channel',
              'schemaVersion',
              'type',
              'nonce',
              'artifactId',
              'x',
              'y',
              'deltaY',
            ])
          )
            return;
          const value = normalizeArtifactViewportZoom(
            { x: own(data, 'x'), y: own(data, 'y'), deltaY: own(data, 'deltaY') },
            artifact.viewport,
          );
          if (value)
            frame.dispatchEvent(
              new CustomEvent(config.viewportZoomEvent, { bubbles: true, detail: value }),
            );
          return;
        }
        if (type === 'viewport.pan') {
          if (
            !trustedLoad ||
            !viewportGesturesEnabled ||
            disposed ||
            !exact(data, [
              'channel',
              'schemaVersion',
              'type',
              'nonce',
              'artifactId',
              'deltaX',
              'deltaY',
            ])
          )
            return;
          const value = normalizeArtifactViewportPan({
            deltaX: own(data, 'deltaX'),
            deltaY: own(data, 'deltaY'),
          });
          if (value)
            frame.dispatchEvent(
              new CustomEvent(config.viewportPanEvent, { bubbles: true, detail: value }),
            );
          return;
        }
        if (type === 'layout.measurement') {
          const layout = own(data, 'layout');
          if (
            !trustedLoad ||
            !exact(data, ['channel', 'schemaVersion', 'type', 'nonce', 'artifactId', 'layout']) ||
            !exact(layout, ['width', 'height']) ||
            !Number.isInteger(layout.width) ||
            !Number.isInteger(layout.height) ||
            layout.width < 1 ||
            layout.width > __PLANR_SANDBOX_LAYOUT_MAX_WIDTH__ ||
            layout.height < 1 ||
            layout.height > __PLANR_SANDBOX_LAYOUT_MAX_HEIGHT__
          )
            return;
          measuredLayout = Object.freeze({ width: layout.width, height: layout.height });
          frame.dispatchEvent(new CustomEvent(config.layoutEvent, { detail: measuredLayout }));
          return;
        }
        const receivedRequestId = own(data, 'requestId');
        if (!trustedLoad || !validRequestId(receivedRequestId) || !pending.has(receivedRequestId))
          return;
        const settle = pending.get(receivedRequestId);
        if (['inspect.point', 'inspect.anchor', 'thumbnail.request'].includes(settle.type)) {
          const result = normalizeArtifactBridgeToolResult(settle.type, data, artifact.viewport);
          if (!result.valid) return;
          pending.delete(receivedRequestId);
          clearTimeout(settle.timer);
          settle.resolve(result.value);
          return;
        }
        if (settle.type === 'export.request') {
          if (type === 'export.error') {
            if (
              !exact(data, [
                'channel',
                'schemaVersion',
                'type',
                'nonce',
                'artifactId',
                'requestId',
                'reason',
              ]) ||
              typeof own(data, 'reason') !== 'string' ||
              own(data, 'reason').length > 256
            )
              return;
            pending.delete(receivedRequestId);
            clearTimeout(settle.timer);
            settle.resolve(null);
            return;
          }
          if (
            type !== 'export.result' ||
            !exact(data, [
              'channel',
              'schemaVersion',
              'type',
              'nonce',
              'artifactId',
              'requestId',
              'dataUrl',
              'width',
              'height',
              'label',
            ])
          )
            return;
          const dataUrl = own(data, 'dataUrl'),
            width = own(data, 'width'),
            height = own(data, 'height'),
            label = own(data, 'label');
          pending.delete(receivedRequestId);
          clearTimeout(settle.timer);
          if (
            typeof dataUrl !== 'string' ||
            dataUrl.length > __PLANR_SANDBOX_EXPORT_MAX_DATA_URL__ ||
            !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl) ||
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 1 ||
            height < 1 ||
            width > __PLANR_SANDBOX_EXPORT_MAX_EDGE__ ||
            height > __PLANR_SANDBOX_EXPORT_MAX_EDGE__ ||
            !validText(label, 128)
          ) {
            settle.resolve(null);
            return;
          }
          settle.resolve(Object.freeze({ dataUrl, width, height, label }));
          return;
        }
        if (!['anchor.result', 'anchor.miss'].includes(type)) return;
        if (
          type === 'anchor.miss' &&
          !exact(data, ['channel', 'schemaVersion', 'type', 'nonce', 'artifactId', 'requestId'])
        )
          return;
        if (
          type === 'anchor.result' &&
          !exact(data, [
            'channel',
            'schemaVersion',
            'type',
            'nonce',
            'artifactId',
            'requestId',
            'anchor',
          ])
        )
          return;
        pending.delete(receivedRequestId);
        clearTimeout(settle.timer);
        if (type === 'anchor.miss') {
          settle.resolve(null);
          return;
        }
        const anchor = data.anchor,
          rect = anchor?.rect,
          viewport = anchor?.viewport;
        const frozen =
          getState?.()?.presentation === 'document' && measuredLayout
            ? measuredLayout
            : artifact.viewport;
        const anchorKeys =
          anchor?.screen === undefined
            ? ['planrId', 'rect', 'viewport']
            : ['planrId', 'screen', 'rect', 'viewport'];
        if (
          !exact(anchor, anchorKeys) ||
          !exact(rect, ['x', 'y', 'width', 'height']) ||
          !exact(viewport, ['width', 'height']) ||
          !validId(anchor?.planrId) ||
          (anchor.screen !== undefined && !validScreen(anchor.screen)) ||
          !['x', 'y', 'width', 'height'].every((key) => validNumber(rect?.[key])) ||
          viewport?.width !== frozen.width ||
          viewport?.height !== frozen.height ||
          rect.x < 0 ||
          rect.y < 0 ||
          rect.width < 0 ||
          rect.height < 0 ||
          rect.x + rect.width > frozen.width ||
          rect.y + rect.height > frozen.height
        ) {
          settle.resolve(null);
          return;
        }
        const value = Object.freeze({
          artifactId: artifact.id,
          planrId: anchor.planrId,
          ...(anchor.screen === undefined ? {} : { screen: anchor.screen }),
          rect: Object.freeze({ ...rect }),
          viewport: frozen,
        });
        settle.resolve(value);
        frame.dispatchEvent(new CustomEvent(config.anchorEvent, { detail: value }));
      };
      addEventListener('message', receive);
      const rememberSource = () => {
        if (immutableSource) return;
        const html = frame.getAttribute('srcdoc') || '';
        if (html) {
          immutableSource = { type: 'srcdoc', value: html };
          return;
        }
        const value = frame.getAttribute('src') || '';
        if (value.startsWith('blob:')) immutableSource = { type: 'url', value };
      };
      const sourceObserver = new MutationObserver(rememberSource);
      sourceObserver.observe(frame, { attributes: true, attributeFilter: ['src', 'srcdoc'] });
      const settlePending = () => {
        for (const value of pending.values()) {
          clearTimeout(value.timer);
          value.resolve(null);
        }
        pending.clear();
      };
      const clearChallenge = () => {
        if (pendingChallenge) {
          clearTimeout(pendingChallenge.timer);
          pendingChallenge = null;
        }
      };
      const failClosed = () => {
        if (failedClosed) return;
        failedClosed = true;
        recovering = false;
        clearChallenge();
        settlePending();
        quarantine(true);
        const inertPolicy = config.frameCsp.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
        inertSource = URL.createObjectURL(
          new Blob(
            [
              '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
                inertPolicy +
                '"><meta name="referrer" content="no-referrer"><title>Artifact blocked</title><p>Artifact navigation was blocked.</p>',
            ],
            { type: 'text/html' },
          ),
        );
        frame.dispatchEvent(
          new CustomEvent(config.navigationEvent, {
            detail: {
              artifactId: artifact.id,
              recovered: false,
              failedClosed: true,
              attempts: navigationAttempts,
            },
          }),
        );
        frame.removeAttribute('srcdoc');
        frame.src = inertSource;
      };
      const recoverNavigation = () => {
        if (failedClosed || !immutableSource) return;
        navigationAttempts += 1;
        if (navigationAttempts >= 3) {
          failClosed();
          return;
        }
        recovering = true;
        trustedLoad = false;
        quarantine(true);
        clearChallenge();
        frame.dispatchEvent(
          new CustomEvent(config.navigationEvent, {
            detail: {
              artifactId: artifact.id,
              recovered: true,
              failedClosed: false,
              attempts: navigationAttempts,
            },
          }),
        );
        if (immutableSource.type === 'srcdoc') {
          frame.removeAttribute('src');
          frame.removeAttribute('srcdoc');
          frame.srcdoc = immutableSource.value;
        } else {
          frame.removeAttribute('srcdoc');
          frame.src = immutableSource.value;
        }
      };
      const challengeCurrentDocument = () => {
        if (failedClosed) return;
        clearChallenge();
        const id = requestId();
        const timer = setTimeout(() => {
          if (pendingChallenge?.id !== id) return;
          pendingChallenge = null;
          recoverNavigation();
        }, 750);
        pendingChallenge = { id, timer };
        frame.contentWindow?.postMessage(
          {
            channel: config.channel,
            schemaVersion: config.schemaVersion,
            type: 'bridge.challenge',
            artifactId: artifact.id,
            requestId: id,
          },
          '*',
        );
      };
      const onFrameLoad = () => {
        rememberSource();
        trustedLoad = false;
        measuredLayout = null;
        quarantine(true);
        challengeCurrentDocument();
      };
      frame.addEventListener('load', onFrameLoad);
      const send = (type, payload = {}) =>
        new Promise((resolve) => {
          if (!trustedLoad || pending.size >= 32) {
            resolve(null);
            return;
          }
          const id = requestId();
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve(null);
          }, ARTIFACT_BRIDGE_OPERATION_TIMEOUTS[type] || 750);
          pending.set(id, { resolve, timer, type });
          frame.contentWindow?.postMessage(
            {
              channel: config.channel,
              schemaVersion: config.schemaVersion,
              type,
              artifactId: artifact.id,
              requestId: id,
              ...payload,
            },
            '*',
          );
        });
      Object.defineProperty(frame, '__openPlanrBridge', {
        value: Object.freeze({
          setViewportGestures: (enabled) => {
            if (typeof enabled !== 'boolean' || disposed) return false;
            if (enabled === viewportGesturesEnabled) return true;
            viewportGesturesEnabled = enabled;
            syncViewportGestures();
            return true;
          },
          hitTest: (x, y) =>
            Number.isFinite(x) && Number.isFinite(y)
              ? send('anchor.hit-test', { x, y })
              : Promise.resolve(null),
          resolve: (planrId, screen) =>
            validText(planrId, 512)
              ? send('anchor.resolve', { planrId, ...(screen ? { screen } : {}) })
              : Promise.resolve(null),
          inspectAt: (x, y) =>
            Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0
              ? send('inspect.point', { x, y })
              : Promise.resolve(null),
          inspect: (anchor) =>
            validId(anchor?.planrId) && (anchor.screen === undefined || validScreen(anchor.screen))
              ? send('inspect.anchor', {
                  planrId: anchor.planrId,
                  ...(anchor.screen === undefined ? {} : { screen: anchor.screen }),
                })
              : Promise.resolve(null),
          thumbnail: () => send('thumbnail.request'),
          exportPng: (target) =>
            ['screen', 'full'].includes(target)
              ? send('export.request', { target })
              : Promise.resolve(null),
        }),
        configurable: true,
      });
      return () => {
        viewportGesturesEnabled = false;
        syncViewportGestures();
        disposed = true;
        removeEventListener('message', receive);
        frame.removeEventListener('load', onFrameLoad);
        sourceObserver.disconnect();
        clearChallenge();
        settlePending();
        if (inertSource) URL.revokeObjectURL(inertSource);
        frame.inert = originalInert;
        frame.style.pointerEvents = originalPointerEvents;
        frame.removeAttribute('aria-busy');
        frame.removeAttribute('csp');
        delete frame.dataset.planrBridgeTrusted;
        try {
          delete frame.__openPlanrBridge;
        } catch {
          // A host that froze the iframe keeps the disposed bridge, which no longer acts.
        }
      };
    },
  };
  globalThis.__OPENPLANR_ARTIFACT_STAGE_OPTIONS__ = Object.freeze({
    async resolveArtifactSource(artifact) {
      if (config.inlineArtifacts) {
        const html = config.inlineArtifacts[artifact.id];
        if (typeof html !== 'string') throw new Error('Artifact source unavailable');
        return new Blob([html], { type: 'text/html' });
      }
      const response = await fetch(config.artifactBaseUrl + encodeURIComponent(artifact.id), {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (
        !response.ok ||
        !(response.headers.get('content-type') || '')
          .toLowerCase()
          .startsWith('application/octet-stream')
      )
        throw new Error('Artifact source unavailable');
      return new Blob([await response.arrayBuffer()], { type: 'text/html' });
    },
    bridgeClient,
    onState(state) {
      dispatchEvent(new CustomEvent('planr:artifact-state', { detail: state }));
    },
  });
  const loadStage = () => {
    const stage = document.createElement('script');
    stage.src = config.stageRuntimeUrl;
    stage.async = false;
    document.head.append(stage);
  };
  if (config.adapterRuntimeUrl) {
    const adapter = document.createElement('script');
    adapter.src = config.adapterRuntimeUrl;
    adapter.async = false;
    adapter.addEventListener('load', loadStage, { once: true });
    adapter.addEventListener(
      'error',
      () => {
        document.documentElement.dataset.planrAdapterError = 'true';
      },
      { once: true },
    );
    document.head.append(adapter);
  } else loadStage();
})();
