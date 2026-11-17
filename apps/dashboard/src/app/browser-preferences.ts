export type ThemeChoice = 'system' | 'light' | 'dark';
export type ShellAdapters = Readonly<{
  loadSingleLetters: () => boolean;
  saveSingleLetters: (enabled: boolean) => void;
  copy: (text: string) => Promise<void>;
  themePreference?: Readonly<{
    initialChoice: ThemeChoice;
    initialStorageError?: boolean;
    save: (choice: ThemeChoice) => void;
  }>;
  chromePreference?: ChromePreference;
  recentItems?: RecentItemsPreference;
}>;

/** Key/value store the floating chrome persists panel and hint state through. */
export type ChromePreferenceStorage = Readonly<{
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}>;

/** Per-project floating-chrome state, kept as one browser entry per project. */
export type ChromePreference = Readonly<{
  storage: (projectId: string) => ChromePreferenceStorage;
}>;

export function chromePreferenceKey(projectId: string): string {
  return `op-chrome:v1:${projectId}`;
}

/** Throws when the stored value is not a JSON object, so the chrome reports it and starts closed. */
export function parseChromePreference(value: string | null): Readonly<Record<string, unknown>> {
  if (value === null) return {};
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`Invalid chrome preference: ${value.slice(0, 80)}`);
  return parsed as Readonly<Record<string, unknown>>;
}

function writableChromeRecord(value: string | null): Readonly<Record<string, unknown>> {
  try {
    return parseChromePreference(value);
  } catch {
    // The chrome's read already reported this corrupt record; the write replaces it.
    return {};
  }
}

/** Browser-local list of item IDs last opened from the palette, per project. */
export type RecentItemsPreference = Readonly<{
  load: (projectId: string) => readonly string[];
  save: (projectId: string, ids: readonly string[]) => void;
}>;

export const RECENT_ITEMS_LIMIT = 5;

function recentItemsKey(projectId: string): string {
  return `op-palette-recent:v1:${projectId}`;
}

/** Throws when the stored value is not a list of IDs, as the shortcut preference does. */
export function parseRecentItems(value: string | null): readonly string[] {
  if (value === null) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string'))
    throw new Error(`Invalid recent palette items: ${value.slice(0, 80)}`);
  return Object.freeze(parsed.slice(0, RECENT_ITEMS_LIMIT));
}

/** Puts the opened ID first and keeps the newest five. */
export function rememberRecentItem(ids: readonly string[], id: string): readonly string[] {
  return Object.freeze([id, ...ids.filter((entry) => entry !== id)].slice(0, RECENT_ITEMS_LIMIT));
}

export function createBrowserShellAdapters(): ShellAdapters {
  const theme =
    typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme');
  return {
    loadSingleLetters: () => {
      if (typeof localStorage === 'undefined') return true;
      const value = localStorage.getItem('op-shortcuts:v1');
      if (value === null || value === 'true') return true;
      if (value === 'false') return false;
      throw new Error('Invalid browser shortcut preference.');
    },
    saveSingleLetters: (enabled) =>
      localStorage.setItem('op-shortcuts:v1', JSON.stringify(enabled)),
    copy: (text) => {
      if (!navigator.clipboard?.writeText)
        return Promise.reject(new Error('Clipboard unavailable'));
      return navigator.clipboard.writeText(text);
    },
    themePreference: {
      initialChoice: theme === 'light' || theme === 'dark' ? theme : 'system',
      initialStorageError:
        typeof document !== 'undefined' &&
        document.documentElement.hasAttribute('data-theme-storage-error'),
      save: (choice) => localStorage.setItem('op-theme', choice),
    },
    chromePreference: {
      storage: (projectId) => {
        const key = chromePreferenceKey(projectId);
        return {
          get: (name) => parseChromePreference(localStorage.getItem(key))[name],
          set: (name, value) =>
            localStorage.setItem(
              key,
              JSON.stringify({ ...writableChromeRecord(localStorage.getItem(key)), [name]: value }),
            ),
        };
      },
    },
    recentItems: {
      load: (projectId) => parseRecentItems(localStorage.getItem(recentItemsKey(projectId))),
      save: (projectId, ids) =>
        localStorage.setItem(recentItemsKey(projectId), JSON.stringify(ids)),
    },
  };
}
