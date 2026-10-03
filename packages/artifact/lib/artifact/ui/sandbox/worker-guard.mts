import type * as Tools from '../bridge-tools.mjs';

declare const __PLANR_SANDBOX_CONTRACT__: {
  channel: string;
  schemaVersion: string;
  artifactId: string;
  nonce: string;
  parentOrigin: string;
};
declare const __PLANR_SANDBOX_BRIDGE_TOOLS__: unknown;
declare const __PLANR_SANDBOX_WORKER_GUARD__: string;
declare const __PLANR_SANDBOX_CONFIG__: {
  channel: string;
  schemaVersion: string;
  nonce: string;
  frameCsp: string;
  sourceTransport: 'blob' | 'srcdoc';
  frameBudget?: number;
  readyEvent: string;
  viewportZoomEvent: string;
  viewportPanEvent: string;
  layoutEvent: string;
  anchorEvent: string;
  navigationEvent: string;
  inlineSources?: Record<string, { html: string; artifactIdToken: string }>;
  inlineArtifactSources?: Record<string, string>;
  inlineArtifacts?: Record<string, string>;
  artifactBaseUrl: string;
  stageRuntimeUrl: string;
  adapterRuntimeUrl?: string;
};
declare const __PLANR_SANDBOX_EXPORT_MAX_EDGE__: number;
declare const __PLANR_SANDBOX_EXPORT_MAX_DATA_URL__: number;
declare const __PLANR_SANDBOX_LAYOUT_MAX_WIDTH__: number;
declare const __PLANR_SANDBOX_LAYOUT_MAX_HEIGHT__: number;
declare const createArtifactBridgeTools: typeof Tools.createArtifactBridgeTools;
declare const createArtifactViewportGestures: typeof Tools.createArtifactViewportGestures;
declare const normalizeArtifactBridgeToolResult: typeof Tools.normalizeArtifactBridgeToolResult;
declare const normalizeArtifactViewportZoom: typeof Tools.normalizeArtifactViewportZoom;
declare const normalizeArtifactViewportPan: typeof Tools.normalizeArtifactViewportPan;
declare const ARTIFACT_BRIDGE_OPERATION_TIMEOUTS: typeof Tools.ARTIFACT_BRIDGE_OPERATION_TIMEOUTS;
declare const importScripts: (...urls: string[]) => void;
// First code in every artifact worker: removes network, storage and nested-worker APIs.
// Bundled into lib/artifact/ui/generated/sandbox-guards.mjs; bridge.mjs embeds it in the
// frame guard, which prepends it to each worker. The CSP and sandbox stay the boundary.
(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the bundled guard runs as a classic script, where the directive applies.
  'use strict';
  const blocked = () => new DOMException('Blocked by OpenPlanr artifact sandbox', 'SecurityError');
  const replace = (owner: object, key: string, value: unknown) => {
    try {
      Object.defineProperty(owner, key, { value, writable: false, configurable: false });
    } catch {
      try {
        (owner as Record<string, unknown>)[key] = value;
      } catch {
        // Neither configurable nor writable: skip it; the CSP still applies.
      }
    }
  };
  const reject = () => Promise.reject(blocked());
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
  for (const key of ['indexedDB', 'caches', 'cookieStore']) {
    try {
      Object.defineProperty(globalThis, key, {
        get() {
          throw blocked();
        },
        configurable: false,
      });
    } catch {
      // Already non-configurable here; the opaque-origin sandbox still denies storage.
    }
  }
  try {
    replace(Navigator.prototype, 'sendBeacon', () => false);
  } catch {
    // Workers expose WorkerNavigator, so Navigator is undefined here.
  }
  try {
    Object.defineProperty(Navigator.prototype, 'serviceWorker', {
      get() {
        throw blocked();
      },
      configurable: false,
    });
  } catch {
    // Workers expose WorkerNavigator, so Navigator is undefined here.
  }
  try {
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      get() {
        throw blocked();
      },
      configurable: false,
    });
  } catch {
    // Workers expose WorkerNavigator, so Navigator is undefined here.
  }
  try {
    if (typeof StorageManager === 'function' && 'getDirectory' in StorageManager.prototype)
      replace(StorageManager.prototype, 'getDirectory', reject);
  } catch {
    // An unusual StorageManager: skip it; the opaque-origin sandbox still denies storage.
  }
  try {
    if (typeof StorageManager === 'function' && 'persist' in StorageManager.prototype)
      replace(StorageManager.prototype, 'persist', reject);
  } catch {
    // An unusual StorageManager: skip it; the opaque-origin sandbox still denies storage.
  }
  for (const key of ['Worker', 'SharedWorker']) {
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
  const nativeImportScripts =
    typeof importScripts === 'function' ? importScripts.bind(globalThis) : null;
  if (nativeImportScripts)
    replace(globalThis, 'importScripts', (...urls: unknown[]) => {
      if (!urls.every((value: unknown) => /^(?:blob:|data:)/i.test(String(value)))) throw blocked();
      return nativeImportScripts(...(urls as string[]));
    });
})();
