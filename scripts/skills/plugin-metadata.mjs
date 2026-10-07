/** Identity shared by the generated Claude, Codex and repository plugin manifests. */
export const PLUGIN_DESCRIPTION =
  'Close the loop from intent to delivery. Plan, design, build, review, and operate from durable context in your repository.';

export const PLUGIN_AUTHOR = Object.freeze({ name: 'OpenPlanr', url: 'https://openplanr.dev' });

export const PLUGIN_LICENSE = 'MIT';

/** Listing fields the Claude plugin directory reads from `plugin.json`. */
export const CLAUDE_PLUGIN_LISTING = Object.freeze({
  displayName: 'OpenPlanr',
  keywords: Object.freeze(['planning', 'specification', 'delivery', 'code-review', 'design']),
  privacyPolicyUrl: 'https://openplanr.dev/privacy',
  termsOfServiceUrl: 'https://openplanr.dev/terms',
  supportUrl: 'https://github.com/openplanr/OpenPlanr/blob/main/SUPPORT.md',
  // Not openplanr.dev/get-started, which is reserved for campaign traffic.
  documentationUrl: 'https://openplanr.dev/docs',
});

/** Square app icon the plugin directory shows beside the listing. */
export const CLAUDE_PLUGIN_ICON = 'docs/assets/brand/openplanr-app-icon.svg';
