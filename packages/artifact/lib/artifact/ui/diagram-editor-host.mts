import type { DiagramAuthoringBundle } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramEditorSession, DiagramEditorState } from '../diagram/editor/index.mjs';
import type { DiagramEditorHostAction, DiagramEditorHostPanel } from './diagram-editor.mjs';
import { hasIcon } from './diagram-editor-dom.mjs';

/** What a host shell passes to mountDiagramEditor. */
export interface DiagramEditorHostOptions {
  /** Re-read a verified owner revision after a rejected stale save. */
  readCurrent?: () => Promise<DiagramAuthoringBundle>;
  /** Optional real reviewer adapter. Local-only pages show a truthful unavailable state. */
  mountReview?: (options: {
    /** Clicks inside this element never reach the editor's action dispatcher. */
    root: HTMLElement;
    session: DiagramEditorSession;
    select: (ids: string[]) => unknown;
  }) => (() => void) | null;
  /** Show the Review tab. Defaults to true. */
  review?: boolean;
  /** Replace the local wording where the host changes what is true. */
  labels?: {
    subtitle?: string;
    emptyHint?: string;
    reviewUnavailable?: string;
    readOnly?: string;
  };
  /** Name the save state in host terms, for example "Saved · revision 8"; null keeps the default. Not used for read-only views. */
  saveLabel?: (state: DiagramEditorState) => string | null;
  /** Show the OpenPlanr mark before the title. Defaults to true. */
  brand?: boolean;
  /** Follow the host's theme instead of the operating system. */
  colorScheme?: 'light' | 'dark' | null;
  actions?: DiagramEditorHostAction[];
  panels?: DiagramEditorHostPanel[];
}
export type DiagramEditorLabels = Required<NonNullable<DiagramEditorHostOptions['labels']>>;
export type DiagramEditorColorScheme = 'light' | 'dark' | null;
/** Host options after validation. */
export interface DiagramEditorHostConfig {
  labels: DiagramEditorLabels;
  actions: DiagramEditorHostAction[];
  panels: DiagramEditorHostPanel[];
  reviewEnabled: boolean;
  colorScheme: DiagramEditorColorScheme;
}
type HostCallback = 'onSelect' | 'mount';
type HostHook = 'disabled' | 'hidden';
/** Every field hostEntries reads; a JavaScript host may pass any value in each. */
type HostEntryFields = { id: string; label: string; icon?: string } & Partial<
  Record<HostCallback | HostHook, unknown>
>;

const DEFAULT_LABELS = Object.freeze({
  subtitle: 'Local diagram studio',
  emptyHint:
    'Add a shape or start with a small process flow. Everything stays local until you save.',
  reviewUnavailable:
    'Review comments are available after this diagram is published to a review workspace. Local editing does not publish it.',
  readOnly: 'Read only',
});
const HOST_ID = /^[a-z][a-z0-9-]{0,39}$/u;
const RESERVED_PANELS = new Set(['properties', 'review']);

function hostLabels(labels: DiagramEditorHostOptions['labels'] = {}): DiagramEditorLabels {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels))
    throw new TypeError('Host labels must be an object.');
  for (const [key, value] of Object.entries(labels)) {
    if (!Object.hasOwn(DEFAULT_LABELS, key)) throw new TypeError(`Unknown host label: ${key}.`);
    if (typeof value !== 'string' || !value.trim())
      throw new TypeError(`Host label ${key} must be non-empty text.`);
  }
  return { ...DEFAULT_LABELS, ...labels };
}
function hostEntries(
  list: DiagramEditorHostAction[] | undefined,
  kind: 'action',
  callback: 'onSelect',
): DiagramEditorHostAction[];
function hostEntries(
  list: DiagramEditorHostPanel[] | undefined,
  kind: 'panel',
  callback: 'mount',
): DiagramEditorHostPanel[];
function hostEntries<Entry extends HostEntryFields>(
  list: Entry[] | undefined,
  kind: 'action' | 'panel',
  callback: HostCallback,
): Entry[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new TypeError(`Host ${kind}s must be an array.`);
  const seen = new Set();
  return list.map((entry) => {
    const id = entry?.id;
    if (!HOST_ID.test(id ?? '') || seen.has(id) || (kind === 'panel' && RESERVED_PANELS.has(id)))
      throw new TypeError(
        `Each host ${kind} needs a unique lowercase id; received ${JSON.stringify(id)}.`,
      );
    if (
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      typeof entry[callback] !== 'function'
    )
      throw new TypeError(`Host ${kind} ${id} needs a label and ${callback}().`);
    if (entry.icon !== undefined && !hasIcon(entry.icon))
      throw new TypeError(`Host ${kind} ${id} uses an unknown icon: ${entry.icon}.`);
    for (const hook of ['disabled', 'hidden'] satisfies HostHook[])
      if (entry[hook] !== undefined && typeof entry[hook] !== 'function')
        throw new TypeError(`Host ${kind} ${id} ${hook} must be a function.`);
    seen.add(id);
    return { ...entry };
  });
}

export function colorSchemeOf(value: unknown): DiagramEditorColorScheme {
  if (value === undefined || value === null) return null;
  if (value !== 'light' && value !== 'dark')
    throw new TypeError(
      `Color scheme must be light, dark or null; received ${JSON.stringify(value)}.`,
    );
  return value;
}

/** Validate the host options once, in a fixed order, before anything is mounted. */
export function readHostOptions(host: DiagramEditorHostOptions): DiagramEditorHostConfig {
  if (host.review !== undefined && typeof host.review !== 'boolean')
    throw new TypeError('Host review must be true or false.');
  if (host.saveLabel !== undefined && typeof host.saveLabel !== 'function')
    throw new TypeError('Host saveLabel must be a function.');
  const labels = hostLabels(host.labels),
    actions = hostEntries(host.actions, 'action', 'onSelect'),
    panels = hostEntries(host.panels, 'panel', 'mount');
  return {
    labels,
    actions,
    panels,
    reviewEnabled: host.review !== false,
    colorScheme: colorSchemeOf(host.colorScheme),
  };
}

/** The host's save-state wording, or null to keep the editor's own. */
export function hostSaveLabel(
  host: DiagramEditorHostOptions,
  state: DiagramEditorState,
): string | null {
  const label = host.saveLabel?.(state) ?? null;
  if (label !== null && (typeof label !== 'string' || !label.trim()))
    throw new TypeError(
      `Host saveLabel must return non-empty text or null; received ${JSON.stringify(label)}.`,
    );
  return label;
}
