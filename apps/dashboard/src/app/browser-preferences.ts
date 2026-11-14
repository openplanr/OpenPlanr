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
  railPreference?: Readonly<{
    initialCompact?: boolean;
    initialStorageError?: boolean;
    save: (compact: boolean) => void;
  }>;
  recentItems?: RecentItemsPreference;
}>;

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
  let initialCompact: boolean | undefined;
  let initialRailStorageError = false;
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem('op-rail-compact:v1');
    if (stored === 'true') initialCompact = true;
    else if (stored === 'false') initialCompact = false;
    else if (stored !== null) initialRailStorageError = true;
  } catch {
    initialRailStorageError = true;
  }
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
      initialChoice: theme === 'light' || theme === 'system' ? theme : 'dark',
      initialStorageError:
        typeof document !== 'undefined' &&
        document.documentElement.hasAttribute('data-theme-storage-error'),
      save: (choice) => localStorage.setItem('op-theme', choice),
    },
    railPreference: {
      initialCompact,
      initialStorageError: initialRailStorageError,
      save: (compact) => localStorage.setItem('op-rail-compact:v1', JSON.stringify(compact)),
    },
    recentItems: {
      load: (projectId) => parseRecentItems(localStorage.getItem(recentItemsKey(projectId))),
      save: (projectId, ids) =>
        localStorage.setItem(recentItemsKey(projectId), JSON.stringify(ids)),
    },
  };
}
