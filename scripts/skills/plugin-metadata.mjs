/** Identity shared by the generated Claude, Codex and repository plugin manifests. */
export const PLUGIN_DESCRIPTION =
  'Close the loop from intent to delivery. Plans as files in your repo, checks before you merge, and a record of what shipped, in Claude Code, Codex and Cursor.';

export const PLUGIN_AUTHOR = Object.freeze({ name: 'OpenPlanr', url: 'https://openplanr.dev' });

export const PLUGIN_LICENSE = 'MIT';

/** Listing fields the Claude plugin directory reads from `plugin.json`. */
export const CLAUDE_PLUGIN_LISTING = Object.freeze({
  displayName: 'OpenPlanr',
  keywords: Object.freeze([
    'coding-agents',
    'agent-harness',
    'code-review',
    'planning',
    'verification',
  ]),
  privacyPolicyUrl: 'https://openplanr.dev/privacy',
  termsOfServiceUrl: 'https://openplanr.dev/terms',
  supportUrl: 'https://github.com/openplanr/OpenPlanr/blob/main/SUPPORT.md',
  // Not openplanr.dev/get-started, which is reserved for campaign traffic.
  documentationUrl: 'https://openplanr.dev/docs',
});

/** Square app icon the plugin directory shows beside the listing. */
export const CLAUDE_PLUGIN_ICON = 'docs/assets/brand/openplanr-app-icon.svg';
