import { inspectPlainData } from '../authoring/model.mjs';

export interface DiagramEditorRecoveryStatus {
  mode: 'available' | 'memory-only';
  warning: string | null;
}
export interface DiagramEditorRecovery {
  load(): unknown | null;
  save(draft: unknown): { ok: boolean } & DiagramEditorRecoveryStatus;
  clear(): { ok: boolean } & DiagramEditorRecoveryStatus;
  status(): DiagramEditorRecoveryStatus;
}
interface DiagramEditorRecoveryOptions {
  /** Supply sessionStorage or a storage adapter; do not store owner URLs/tokens. */
  storage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): unknown;
    removeItem(key: string): unknown;
  } | null;
  /** Use the scope returned by the authenticated local owner, never unverified document input. */
  scope: { sessionId: string; diagramId: string };
  maxBytes?: number;
}
/** A stored entry as parsed, before any field is trusted. */
interface StoredRecovery {
  version?: unknown;
  scope?: { sessionId?: unknown; diagramId?: unknown } | null;
  draft?: unknown;
}

const MAX_RECOVERY_BYTES = 2 * 1024 * 1024;
const scopePart = /^[a-zA-Z0-9_-]{1,160}$/u;

/** Recovery is a bounded convenience, never an acknowledgement or authority. */
export function createDiagramEditorRecovery(
  // biome-ignore format: bundles keep this one-line pattern; wrapping would change their bytes.
  { storage, scope, maxBytes = MAX_RECOVERY_BYTES }: DiagramEditorRecoveryOptions,
): DiagramEditorRecovery {
  if (!scope || !scopePart.test(scope.sessionId) || !scopePart.test(scope.diagramId))
    throw new TypeError('Recovery requires a verified owner session and diagram scope.');
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RECOVERY_BYTES)
    throw new TypeError('Invalid recovery byte limit.');
  const boundScope = { sessionId: scope.sessionId, diagramId: scope.diagramId };
  const key = `openplanr:diagram-editor:1:${boundScope.sessionId}:${boundScope.diagramId}`;
  let quarantined = false;
  let mode: DiagramEditorRecoveryStatus['mode'] = storage ? 'available' : 'memory-only';
  let warning = storage
    ? null
    : 'Pending edits survive only in this open session; recovery storage is unavailable.';
  const unavailable = (message: string): { ok: false } & DiagramEditorRecoveryStatus => {
    mode = 'memory-only';
    warning = message;
    return { ok: false, mode, warning };
  };
  return {
    status: () => ({ mode, warning }),
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        if (raw === null) return null;
        if (
          typeof raw !== 'string' ||
          raw.length > maxBytes ||
          new TextEncoder().encode(raw).length > maxBytes
        )
          throw new Error('Recovery exceeds its size limit.');
        const value: StoredRecovery | null = JSON.parse(raw);
        if (
          inspectPlainData(value).length ||
          value?.version !== 1 ||
          value.scope?.sessionId !== boundScope.sessionId ||
          value.scope?.diagramId !== boundScope.diagramId ||
          !value.draft ||
          typeof value.draft !== 'object' ||
          Array.isArray(value.draft) ||
          Object.keys(value).some((name) => !['version', 'scope', 'draft'].includes(name))
        )
          throw new Error('Recovery does not match this owner session and diagram.');
        return value.draft;
      } catch {
        quarantined = true;
        unavailable(
          'Stored recovery could not be read safely. Pending edits remain in memory only.',
        );
        return null;
      }
    },
    save(draft) {
      if (quarantined)
        return unavailable(
          'Existing recovery could not be safely loaded and has not been replaced. Keep this session open; new edits remain in memory only.',
        );
      if (!storage)
        return unavailable(
          'Pending edits survive only in this open session; recovery storage is unavailable.',
        );
      try {
        if (inspectPlainData(draft).length) throw new Error('Invalid recovery data.');
        const bytes = JSON.stringify({ version: 1, scope: boundScope, draft });
        if (bytes.length > maxBytes || new TextEncoder().encode(bytes).length > maxBytes)
          throw new Error('Recovery exceeds its size limit.');
        storage.setItem(key, bytes);
        mode = 'available';
        warning = null;
        return { ok: true, mode, warning };
      } catch {
        // A stale earlier draft must not masquerade as the current recoverable one.
        try {
          storage.removeItem(key);
        } catch {
          /* Storage is unavailable. */
        }
        return unavailable(
          'Pending edits could not be stored for refresh recovery. Keep this session open or save to the owner.',
        );
      }
    },
    clear() {
      if (quarantined) return { ok: false, mode, warning };
      if (!storage) return { ok: true, mode, warning };
      try {
        storage.removeItem(key);
        return { ok: true, mode, warning };
      } catch {
        return unavailable(
          'Recovery storage could not be cleared. Close this browser session before changing access.',
        );
      }
    },
  };
}
