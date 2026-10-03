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
  /** Exact host challenge ID, exposed only after the current document authenticates. */
  generation?: string | null;
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
  let revision = 0,
    disposed = false;
  type SequenceCustody = {
    nonce: string;
    generation: string;
    sequence: number;
    documentId?: string;
    modern?: true;
    legacy?: true;
  };
  const sequences = new WeakMap<Window, SequenceCustody>();
  const custody = (frame: PrototypeFrame) => {
    if (!frame.window || !frame.nonce) return null;
    // Older hosts do not expose a load challenge. Fresh windows/nonces retain
    // their existing lifetime; reusable frames must supply the trusted generation.
    const generation = frame.generation === undefined ? frame.nonce : frame.generation;
    if (typeof generation !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._:-]{7,127}$/.test(generation))
      return null;
    let current = sequences.get(frame.window);
    if (current?.nonce !== frame.nonce || current.generation !== generation) {
      current = {
        nonce: frame.nonce,
        generation,
        sequence: 0,
        ...(current?.nonce === frame.nonce && current.modern ? { modern: true as const } : {}),
      };
      sequences.set(frame.window, current);
    }
    return current;
  };
  const restore = (frame: PrototypeFrame, documentId?: string) => {
    if (disposed || !frame.nonce || !/^[A-Za-z0-9_-]{43}$/.test(frame.nonce)) return;
    const current = custody(frame);
    if (!current) return;
    const aliases = validatePrototypeStateAliases(frame.aliases) ? frame.aliases : undefined;
    frame.window?.postMessage(
      {
        type: 'openplanr:prototype-state:restore',
        version: 1,
        nonce: frame.nonce,
        screenId: frame.screenId,
        viewId: frame.viewId,
        state: snapshot,
        revision,
        acknowledgedSequence: current.sequence,
        ...(frame.generation !== undefined
          ? {
              generation: current.generation,
              ...(documentId || current.documentId
                ? { documentId: documentId ?? current.documentId }
                : {}),
            }
          : {}),
        ...(aliases ? { aliases } : {}),
      },
      '*',
    );
    if (
      aliases &&
      (frame.generation === undefined ||
        current.legacy ||
        (current.documentId && (!documentId || documentId === current.documentId)))
    ) {
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
      disposed ||
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
    const current = custody(frame);
    if (!current) return false;
    const modern =
      frame.generation !== undefined &&
      (data.generation !== undefined || data.documentId !== undefined);
    if (modern) {
      if (typeof data.documentId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.documentId))
        return false;
      if (data.generation === null) {
        // Configuration requests do not change sequence custody. The response is
        // addressed to that bootstrap, so queued requests from an old document
        // cannot configure its replacement at the same WindowProxy and nonce.
        current.modern = true;
        delete current.legacy;
        restore(frame, data.documentId);
        return data.type === 'openplanr:prototype-state:ready';
      }
      if (
        data.generation !== current.generation ||
        (current.documentId && data.documentId !== current.documentId)
      )
        return false;
    } else if (current.modern) return false;
    if (data.type === 'openplanr:prototype-state:ready') {
      if (modern) {
        current.documentId = data.documentId;
        current.modern = true;
        delete current.legacy;
      } else current.legacy = true;
      restore(frame);
      return true;
    }
    if (!validatePrototypeSnapshot(data.state)) return false;
    if (data.sequence !== undefined) {
      if (
        !Number.isSafeInteger(data.sequence) ||
        data.sequence <= 0 ||
        !Array.isArray(data.sessionKeys) ||
        data.sessionKeys.length > 256 ||
        Object.keys(data.sessionKeys).length !== data.sessionKeys.length ||
        new Set(data.sessionKeys).size !== data.sessionKeys.length ||
        !Array.from(data.sessionKeys).every(
          (key: unknown) =>
            typeof key === 'string' &&
            key.length <= 256 &&
            !['__proto__', 'constructor', 'prototype'].includes(key),
        ) ||
        new TextEncoder().encode(JSON.stringify(data.sessionKeys)).byteLength > 16_384 ||
        !data.sessionSequences ||
        typeof data.sessionSequences !== 'object' ||
        Object.getPrototypeOf(data.sessionSequences) !== Object.prototype ||
        Object.keys(data.sessionSequences).length !== data.sessionKeys.length ||
        !data.sessionKeys.every(
          (key: string) =>
            Object.hasOwn(data.sessionSequences, key) &&
            Number.isSafeInteger(data.sessionSequences[key]) &&
            data.sessionSequences[key] > 0 &&
            data.sessionSequences[key] <= data.sequence,
        ) ||
        new TextEncoder().encode(JSON.stringify(data.sessionSequences)).byteLength > 16_384 ||
        (data.reset !== undefined &&
          (data.reset !== true ||
            !Number.isSafeInteger(data.resetSequence) ||
            data.resetSequence <= 0 ||
            data.resetSequence > data.sequence)) ||
        !frame.window
      )
        return false;
      const previous = current;
      if (data.sequence <= previous.sequence) return false;
      // Only changed session keys and this view's fields can replace shared state.
      // Independent view updates compose; the last accepted edit wins for the same key.
      const next: PrototypeSnapshot =
        data.reset && data.resetSequence > previous.sequence
          ? { session: {}, forms: {} }
          : structuredClone(snapshot);
      for (const key of data.sessionKeys) {
        if (data.sessionSequences[key] <= previous.sequence) continue;
        if (Object.hasOwn(data.state.session, key)) next.session[key] = data.state.session[key];
        else delete next.session[key];
      }
      if (Object.hasOwn(data.state.forms, frame.viewId))
        next.forms[frame.viewId] = data.state.forms[frame.viewId];
      if (!validatePrototypeSnapshot(next)) return false;
      snapshot = structuredClone(next);
      sequences.set(frame.window, {
        nonce: data.nonce,
        generation: current.generation,
        sequence: data.sequence,
        ...(modern ? { documentId: data.documentId } : {}),
        ...(modern ? { modern: true as const } : {}),
        ...(!modern ? { legacy: true as const } : {}),
      });
      revision++;
      // The sender needs an acknowledgement before retiring its local edits.
      for (const current of frames()) restore(current);
    } else {
      // Once this window/nonce has established ordering, legacy snapshots cannot
      // downgrade it. A genuinely legacy or newly loaded frame stays compatible.
      if (current.sequence > 0 || current.documentId) return false;
      // Existing v1 bootstraps remain readable with their original snapshot semantics.
      snapshot = structuredClone(data.state);
      current.legacy = true;
      revision++;
      for (const other of frames()) if (other.window !== event.source) restore(other);
    }
    return true;
  };
  if (!receiveOnly) parentWindow?.addEventListener('message', receive);
  return {
    receive,
    restore,
    snapshot: () => structuredClone(snapshot),
    dispose() {
      parentWindow?.removeEventListener('message', receive);
      disposed = true;
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
  let aliasRestoreType = '';
  let aliasesConfigured = false;
  // Preserve only native edits until the host declares its legacy alias fields.
  const earlyFields = new Map<
    string,
    { value: string; fieldKey: string; formValue: PrototypeJson; sequence: number }
  >();
  let sequence = 0,
    hostRevision = -1,
    acknowledgedSequence = 0,
    pendingReset = 0;
  // This document identity is ephemeral and carries no credential. A queued
  // restore for the preceding document cannot configure a reused WindowProxy.
  const documentId = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
  let generation: string | null = null;
  // Compact by semantic key, rather than retaining an unbounded event queue.
  const pendingSession = new Map<
    string,
    { sequence: number; present: boolean; value?: PrototypeJson }
  >();
  let pendingForm: {
    sequence: number;
    value: PrototypeSnapshot['forms'][string];
  } | null = null;
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
  const post = (
    type: string,
    update?: {
      sessionKeys: string[];
      sessionSequences: Record<string, number>;
      reset?: true;
      resetSequence?: number;
    },
  ) =>
    win.parent.postMessage(
      {
        type,
        version: 1,
        nonce,
        screenId,
        viewId,
        documentId,
        generation,
        ...(type === 'openplanr:prototype-state' ? { state: snapshot, sequence, ...update } : {}),
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
  function capture(sessionValue = snapshot.session) {
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
    const session = { ...sessionValue };
    for (const field of fields()) {
      if (
        aliasesConfigured &&
        aliasFields.includes(field.id) &&
        typeof field.value === 'string' &&
        field.value.length <= 4000
      )
        session[field.id] = field.value;
    }
    const next = { session, forms: { ...snapshot.forms, [viewId]: form } };
    return commit(next);
  }
  function commit(next: PrototypeSnapshot, reset = false) {
    if (!valid(next) || sequence === Number.MAX_SAFE_INTEGER) return false;
    const keys = [
      ...new Set([...Object.keys(snapshot.session), ...Object.keys(next.session)]),
    ].filter(
      (key) =>
        Object.hasOwn(snapshot.session, key) !== Object.hasOwn(next.session, key) ||
        JSON.stringify(snapshot.session[key]) !== JSON.stringify(next.session[key]),
    );
    // Pending custody is bounded independently of the visible snapshot.
    const pending = new Map(pendingSession);
    if (reset) pending.clear();
    for (const key of keys)
      pending.set(key, {
        sequence: sequence + 1,
        present: Object.hasOwn(next.session, key),
        value: next.session[key],
      });
    if (
      pending.size > 256 ||
      new TextEncoder().encode(JSON.stringify([...pending])).byteLength > 16_384
    )
      return false;
    sequence++;
    pendingSession.clear();
    for (const [key, value] of pending) pendingSession.set(key, value);
    if (reset) {
      earlyFields.clear();
      pendingReset = sequence;
      pendingForm = null;
    } else if (Object.hasOwn(next.forms, viewId))
      pendingForm = { sequence, value: structuredClone(next.forms[viewId]) };
    snapshot = structuredClone(next);
    postPending();
    return true;
  }
  function postPending() {
    post('openplanr:prototype-state', {
      sessionKeys: [...pendingSession.keys()],
      sessionSequences: Object.fromEntries(
        [...pendingSession].map(([key, update]) => [key, update.sequence]),
      ),
      ...(pendingReset ? { reset: true as const, resetSequence: pendingReset } : {}),
    });
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
      if (!capture(structuredClone(value)))
        throw new TypeError('Pending prototype edits exceed their bounded JSON contract.');
      // Explicit newer API keys supersede pre-configuration field intent.
      for (const key of Object.keys(value)) earlyFields.delete(key);
    },
    reset() {
      if (!commit({ session: {}, forms: {} }, true))
        throw new TypeError('Pending prototype edits exceed their bounded JSON contract.');
    },
  });
  win.addEventListener('message', (event) => {
    const data = event.data;
    if (
      event.source === win.parent &&
      (parentOrigin === '*' || event.origin === parentOrigin) &&
      data?.nonce === nonce &&
      aliasRestoreType &&
      data.type === aliasRestoreType
    ) {
      // Legacy listeners run after this trusted bootstrap. Project the already merged
      // session so a second, delayed alias message cannot restore stale field values.
      data.state = Object.fromEntries(
        aliasFields.flatMap((field) => {
          const early = !aliasesConfigured ? earlyFields.get(field) : undefined;
          const value = early?.value ?? snapshot.session[field];
          return typeof value === 'string' && value.length <= 4000 ? [[field, value]] : [];
        }),
      );
      return;
    }
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
    const configuring = generation === null && data.generation !== undefined;
    if (data.generation !== undefined) {
      if (
        typeof data.generation !== 'string' ||
        !/^[A-Za-z0-9_-][A-Za-z0-9._:-]{7,127}$/.test(data.generation)
      )
        return;
      if (data.documentId === undefined) {
        post('openplanr:prototype-state:ready');
        return;
      }
      if (data.documentId !== documentId || (generation !== null && data.generation !== generation))
        return;
    } else if (generation !== null) return;
    // A delayed restore cannot replace edits which the host has not acknowledged.
    // Sequence fields are additive to v1; old bootstraps ignore them.
    if (data.revision !== undefined) {
      if (
        !Number.isSafeInteger(data.revision) ||
        data.revision < 0 ||
        data.revision < hostRevision ||
        !Number.isSafeInteger(data.acknowledgedSequence) ||
        data.acknowledgedSequence < acknowledgedSequence ||
        data.acknowledgedSequence > sequence
      )
        return;
    } else if (hostRevision >= 0) return;
    const aliases = data.aliases;
    aliasRestoreType =
      aliases?.version === 1 &&
      typeof aliases.restoreType === 'string' &&
      /^[a-zA-Z][a-zA-Z0-9:_-]{0,127}$/.test(aliases.restoreType) &&
      !aliases.restoreType.startsWith('openplanr:')
        ? aliases.restoreType
        : '';
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
    // An old host retains its original snapshot semantics. Once ordering has been
    // established, an unsequenced restore cannot downgrade the same channel.
    const ack = data.revision === undefined ? sequence : data.acknowledgedSequence;
    const next = structuredClone(data.state) as PrototypeSnapshot;
    if (pendingReset > ack) {
      next.session = {};
      next.forms = {};
    }
    for (const [key, update] of pendingSession) {
      if (update.sequence <= ack) continue;
      if (update.present && update.value !== undefined) next.session[key] = update.value;
      else delete next.session[key];
    }
    if (pendingForm && pendingForm.sequence > ack) next.forms[viewId] = pendingForm.value;
    if (!valid(next)) return;
    // Acknowledged early fields survive only while the host's current view
    // still contains the same value. A later authoritative reset/change retires them.
    for (const [field, early] of earlyFields)
      if (
        early.sequence <= ack &&
        JSON.stringify(data.state.forms[viewId]?.[early.fieldKey]) !==
          JSON.stringify(early.formValue)
      )
        earlyFields.delete(field);
    hostRevision = data.revision ?? hostRevision;
    if (data.generation !== undefined) generation = data.generation;
    acknowledgedSequence = data.revision === undefined ? 0 : ack;
    if (pendingReset <= ack) pendingReset = 0;
    for (const [key, update] of pendingSession)
      if (update.sequence <= ack) pendingSession.delete(key);
    if (pendingForm && pendingForm.sequence <= ack) pendingForm = null;
    snapshot = next;
    if (!aliasesConfigured && aliasRestoreType) {
      const promoted = structuredClone(snapshot);
      for (const field of aliasFields) {
        const early = earlyFields.get(field);
        if (!early || (pendingSession.get(field)?.sequence ?? 0) > early.sequence) continue;
        promoted.session[field] = early.value;
        promoted.forms[viewId] ??= {};
        promoted.forms[viewId][early.fieldKey] = early.formValue;
      }
      // First alias configuration may follow an already acknowledged form edit.
      // Promote configured local fields with a fresh sequence, never a retired one.
      if (!aliasFields.some((field) => earlyFields.has(field)) || commit(promoted)) {
        aliasesConfigured = true;
        earlyFields.clear();
      }
      // Failed promotion leaves bounded early/form custody intact. The legacy
      // projection preserves those fields until a later snapshot permits promotion.
    }
    apply();
    win.dispatchEvent(
      new CustomEvent('openplanr:prototype-state-restored', {
        detail: structuredClone(snapshot.session),
      }),
    );
    // A fresh authoritative snapshot can free capacity for rejected local edits.
    // Replay once on that actual message; a rejection has no reply or busy loop.
    if (data.revision !== undefined && (pendingSession.size || pendingReset || pendingForm))
      postPending();
    else if (configuring) post('openplanr:prototype-state:ready');
  });
  const captureField = (event: Event) => {
    if (!capture() || aliasesConfigured) return;
    const field = fields().find((candidate) => candidate === event.target);
    if (
      !field ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(field.id) ||
      ['constructor', 'prototype', '__proto__'].includes(field.id) ||
      field.value.length > 4000
    )
      return;
    const key = fieldKey(field, fields().indexOf(field));
    const next = new Map(earlyFields);
    next.set(field.id, {
      value: field.value,
      fieldKey: key,
      formValue: snapshot.forms[viewId][key],
      sequence,
    });
    if (next.size > 128 || new TextEncoder().encode(JSON.stringify([...next])).byteLength > 16_384)
      return;
    earlyFields.clear();
    for (const [id, value] of next) earlyFields.set(id, value);
  };
  document.addEventListener('input', captureField, true);
  document.addEventListener('change', captureField, true);
  document.addEventListener('submit', () => capture(), true);
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
