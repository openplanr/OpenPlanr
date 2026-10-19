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
    initialCompact: boolean;
    initialStorageError?: boolean;
    save: (compact: boolean) => void;
  }>;
}>;

export function createBrowserShellAdapters(): ShellAdapters {
  const theme =
    typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme');
  let initialCompact = false;
  let initialRailStorageError = false;
  try {
    const stored =
      typeof localStorage === 'undefined' ? null : localStorage.getItem('op-rail-compact:v1');
    if (stored === 'true') initialCompact = true;
    else if (stored !== null && stored !== 'false') initialRailStorageError = true;
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
  };
}
