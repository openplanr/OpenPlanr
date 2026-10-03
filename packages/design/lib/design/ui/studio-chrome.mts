import {
  type DesignChromeState,
  mountDesignStudioChrome,
  mountStudioPanelDialogs,
} from '@openplanr/artifact/ui/studio-shell-mount.mjs';

export type { DesignChromeState };
export function mountDesignChrome(input: Parameters<typeof mountDesignStudioChrome>[0]) {
  return mountDesignStudioChrome(input);
}
export function mountDesignPanels(input: Parameters<typeof mountStudioPanelDialogs>[0]) {
  return mountStudioPanelDialogs(input);
}
