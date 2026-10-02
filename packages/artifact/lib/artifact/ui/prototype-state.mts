/** Bounded, page-local prototype state. This bridge carries no management capability. */
export type PrototypeJson =
  | null
  | boolean
  | number
  | string
  | PrototypeJson[]
  | { [key: string]: PrototypeJson };
export interface PrototypeSnapshot {
  session: { [key: string]: PrototypeJson };
  forms: { [viewId: string]: { [field: string]: PrototypeJson } };
}
export const PROTOTYPE_STATE_MAX_BYTES = 16_384;
export function validatePrototypeSnapshot(value: unknown): value is PrototypeSnapshot {
  let keys = 0;
  function visit(node: unknown, depth: number): boolean {
    if (depth > 6) return false;
    if (node === null || typeof node === 'boolean') return true;
    if (typeof node === 'number') return Number.isFinite(node);
    if (typeof node === 'string') return node.length <= 8_192;
    if (Array.isArray(node))
      return node.length <= 128 && node.every((item) => visit(item, depth + 1));
    if (!node || typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype)
      return false;
    return Object.entries(node).every(
      ([key, item]) =>
        ++keys <= 128 &&
        key.length <= 256 &&
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        visit(item, depth + 1),
    );
  }
  try {
    const snapshot = value as PrototypeSnapshot;
    return (
      !!snapshot &&
      Object.keys(snapshot).every((key) => key === 'session' || key === 'forms') &&
      !!snapshot.session &&
      !Array.isArray(snapshot.session) &&
      typeof snapshot.session === 'object' &&
      !!snapshot.forms &&
      !Array.isArray(snapshot.forms) &&
      typeof snapshot.forms === 'object' &&
      visit(snapshot, 0) &&
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= 16_384
    );
  } catch {
    return false;
  }
}
/** Trusted, opt-in field capture for older authored prototypes. No legacy inbound message is accepted. */
export interface PrototypeStateAliases {
  version: 1;
  restoreType: string;
  fields: readonly string[];
}
export function validatePrototypeStateAliases(value: unknown): value is PrototypeStateAliases {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const aliases = value as PrototypeStateAliases;
  return (
    Object.keys(aliases).every((key) => ['version', 'restoreType', 'fields'].includes(key)) &&
    aliases.version === 1 &&
    typeof aliases.restoreType === 'string' &&
    /^[a-zA-Z][a-zA-Z0-9:_-]{0,127}$/.test(aliases.restoreType) &&
    !aliases.restoreType.startsWith('openplanr:') &&
    Array.isArray(aliases.fields) &&
    aliases.fields.length > 0 &&
    aliases.fields.length <= 32 &&
    new Set(aliases.fields).size === aliases.fields.length &&
    aliases.fields.every(
      (field) =>
        typeof field === 'string' &&
        /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(field) &&
        !['constructor', 'prototype', '__proto__'].includes(field),
    )
  );
}
export interface PrototypeFrame {
  screenId: string;
  viewId: string;
  window: Window | null;
  nonce: string | null;
  aliases?: PrototypeStateAliases;
}
export function createPrototypeStateRelay({
  contextId,
  frames,
  parentWindow = globalThis.window,
  receiveOnly = false,
}: {
  contextId: string;
  frames: () => readonly PrototypeFrame[];
  parentWindow?: Window;
  receiveOnly?: boolean;
}) {
  if (!contextId) throw new TypeError('Prototype state requires a document/revision context.');
  let snapshot: PrototypeSnapshot = { session: {}, forms: {} };
  const restore = (frame: PrototypeFrame) => {
    if (!frame.nonce || !/^[A-Za-z0-9_-]{43}$/.test(frame.nonce)) return;
    const aliases = validatePrototypeStateAliases(frame.aliases) ? frame.aliases : undefined;
    frame.window?.postMessage(
      {
        type: 'openplanr:prototype-state:restore',
        version: 1,
        nonce: frame.nonce,
        screenId: frame.screenId,
        viewId: frame.viewId,
        state: snapshot,
        ...(aliases ? { aliases } : {}),
      },
      '*',
    );
    if (aliases) {
      const state = Object.fromEntries(
        aliases.fields.flatMap((field) => {
          const value = snapshot.session[field];
          return typeof value === 'string' && value.length <= 4000 ? [[field, value]] : [];
        }),
      );
      frame.window?.postMessage({ type: aliases.restoreType, nonce: frame.nonce, state }, '*');
    }
  };
  const receive = (event: MessageEvent) => {
    const data = event.data;
    if (
      event.origin !== 'null' ||
      !data ||
      typeof data.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(data.nonce) ||
      !['openplanr:prototype-state', 'openplanr:prototype-state:ready'].includes(data.type) ||
      data.version !== 1
    )
      return false;
    const frame = frames().find(
      (frame) =>
        frame.window === event.source &&
        frame.screenId === data.screenId &&
        frame.viewId === data.viewId &&
        frame.nonce === data.nonce,
    );
    if (!frame) return false;
    if (data.type === 'openplanr:prototype-state:ready') {
      restore(frame);
      return true;
    }
    if (!validatePrototypeSnapshot(data.state)) return false;
    snapshot = structuredClone(data.state);
    for (const other of frames()) if (other.window !== event.source) restore(other);
    return true;
  };
  if (!receiveOnly) parentWindow?.addEventListener('message', receive);
  return {
    receive,
    restore,
    snapshot: () => structuredClone(snapshot),
    dispose() {
      parentWindow?.removeEventListener('message', receive);
      snapshot = { session: {}, forms: {} };
    },
  };
}
/** This standalone function is stringified into the trusted bootstrap before authored scripts. */
function installPrototypeState(
  screenId: string,
  viewId: string,
  parentOrigin: string,
  nonce: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) return;
  const win = window as Window &
    typeof globalThis & {
      __OPENPLANR_PROTOTYPE_STATE__?: {
        get(): PrototypeSnapshot['session'];
        set(value: PrototypeSnapshot['session']): void;
        reset(): void;
      };
    };
  let snapshot: PrototypeSnapshot = { session: {}, forms: {} },
    restoring = false;
  let aliasFields: readonly string[] = [];
  // Keep this validator self-contained: the portable bootstrap has no module imports.
  function valid(value: PrototypeSnapshot) {
    let keys = 0;
    function visit(node: PrototypeJson, depth: number): boolean {
      if (depth > 6) return false;
      if (node === null || typeof node === 'boolean') return true;
      if (typeof node === 'number') return Number.isFinite(node);
      if (typeof node === 'string') return node.length <= 8_192;
      if (Array.isArray(node))
        return node.length <= 128 && node.every((item) => visit(item, depth + 1));
      if (!node || typeof node !== 'object' || Object.getPrototypeOf(node) !== Object.prototype)
        return false;
      return Object.entries(node).every(
        ([key, item]) =>
          ++keys <= 128 &&
          key.length <= 256 &&
          !['__proto__', 'constructor', 'prototype'].includes(key) &&
          visit(item, depth + 1),
      );
    }
    try {
      return (
        !!value &&
        Object.keys(value).every((key) => key === 'session' || key === 'forms') &&
        !!value.session &&
        !Array.isArray(value.session) &&
        typeof value.session === 'object' &&
        !!value.forms &&
        !Array.isArray(value.forms) &&
        typeof value.forms === 'object' &&
        visit(value as unknown as PrototypeJson, 0) &&
        new TextEncoder().encode(JSON.stringify(value)).byteLength <= 16_384
      );
    } catch {
      return false;
    }
  }
  const post = (type: string) =>
    win.parent.postMessage(
      {
        type,
        version: 1,
        nonce,
        screenId,
        viewId,
        ...(type === 'openplanr:prototype-state' ? { state: snapshot } : {}),
      },
      parentOrigin,
    );
  const fields = () =>
    [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input,textarea,select',
      ),
    ].filter(
      (field) =>
        !['password', 'file', 'hidden', 'submit', 'button', 'reset'].includes(field.type) &&
        !field.hasAttribute('data-planr-state-private'),
    );
  const fieldKey = (
    field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    index: number,
  ) =>
    (field.id || field.name || `field-${index}`).slice(0, 256) +
    (field.type === 'radio' ? `:${field.value}` : '');
  function capture() {
    if (restoring) return;
    const form: Record<string, PrototypeJson> = {};
    fields().forEach((field, index) => {
      const input = field as HTMLInputElement;
      form[fieldKey(field, index)] = ['checkbox', 'radio'].includes(field.type)
        ? input.checked
        : field instanceof HTMLSelectElement && field.multiple
          ? [...field.selectedOptions].map((option) => option.value)
          : field.value;
    });
    const session = { ...snapshot.session };
    for (const field of fields()) {
      if (
        aliasFields.includes(field.id) &&
        typeof field.value === 'string' &&
        field.value.length <= 4000
      )
        session[field.id] = field.value;
    }
    const next = { session, forms: { ...snapshot.forms, [viewId]: form } };
    if (valid(next)) {
      snapshot = next;
      post('openplanr:prototype-state');
    }
  }
  function apply() {
    const form = snapshot.forms[viewId];
    if (!form) return;
    restoring = true;
    fields().forEach((field, index) => {
      const value = form[fieldKey(field, index)];
      if (value === undefined) return;
      if (['checkbox', 'radio'].includes(field.type) && typeof value === 'boolean')
        (field as HTMLInputElement).checked = value;
      else if (field instanceof HTMLSelectElement && field.multiple && Array.isArray(value))
        for (const option of field.options) option.selected = value.includes(option.value);
      else if (typeof value === 'string') field.value = value;
    });
    restoring = false;
  }
  win.__OPENPLANR_PROTOTYPE_STATE__ = Object.freeze({
    get: () => structuredClone(snapshot.session),
    set(value: PrototypeSnapshot['session']) {
      const next = { session: value, forms: snapshot.forms };
      if (!valid(next)) throw new TypeError('Prototype state exceeds its bounded JSON contract.');
      snapshot = structuredClone(next);
      capture();
      post('openplanr:prototype-state');
    },
    reset() {
      snapshot = { session: {}, forms: {} };
      post('openplanr:prototype-state');
    },
  });
  win.addEventListener('message', (event) => {
    const data = event.data;
    if (
      event.source !== win.parent ||
      (parentOrigin !== '*' && event.origin !== parentOrigin) ||
      data?.type !== 'openplanr:prototype-state:restore' ||
      data.version !== 1 ||
      data.nonce !== nonce ||
      data.screenId !== screenId ||
      data.viewId !== viewId ||
      !valid(data.state)
    )
      return;
    const aliases = data.aliases;
    aliasFields =
      aliases?.version === 1 &&
      Array.isArray(aliases.fields) &&
      aliases.fields.length <= 32 &&
      aliases.fields.every(
        (field: unknown) =>
          typeof field === 'string' &&
          /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(field) &&
          !['constructor', 'prototype', '__proto__'].includes(field),
      )
        ? aliases.fields
        : [];
    snapshot = structuredClone(data.state);
    apply();
    win.dispatchEvent(
      new CustomEvent('openplanr:prototype-state-restored', {
        detail: structuredClone(snapshot.session),
      }),
    );
  });
  document.addEventListener('input', capture, true);
  document.addEventListener('change', capture, true);
  document.addEventListener('submit', capture, true);
  if (document.readyState === 'loading')
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        apply();
        post('openplanr:prototype-state:ready');
      },
      { once: true },
    );
  else {
    apply();
    post('openplanr:prototype-state:ready');
  }
  post('openplanr:prototype-state:ready');
  win.setTimeout(() => post('openplanr:prototype-state:ready'), 500);
}
export function renderPrototypeStateBootstrap({
  screenId,
  viewId = screenId,
  parentOrigin,
  nonce,
}: {
  screenId: string;
  viewId?: string;
  parentOrigin: string;
  nonce: string;
}) {
  if (!screenId || !viewId || !parentOrigin || !/^[A-Za-z0-9_-]{43}$/.test(nonce))
    throw new TypeError('Prototype bootstrap requires screen/view identity and parent origin.');
  const args = JSON.stringify([screenId, viewId, parentOrigin, nonce]).replace(/</gu, '\\u003c');
  return `;(${installPrototypeState.toString()})(...${args});`;
}

/** Let pooled guards bind their existing artifactId config without a second template token. */
export function renderPrototypeStateInstaller() {
  return installPrototypeState.toString();
}
