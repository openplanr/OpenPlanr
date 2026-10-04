import { createWorkspaceAddress } from '@openplanr/artifact/internal/workspace-address.mjs';

export const DESIGN_SHARE_BASE_URL = 'https://share.openplanr.dev';
export const DESIGN_SHARE_REVIEW_PATH = '/d';
const address = createWorkspaceAddress({
  label: 'Design',
  reviewPath: DESIGN_SHARE_REVIEW_PATH,
  defaultBaseUrl: DESIGN_SHARE_BASE_URL,
});
export const normalizeWorkspaceBase = address.normalizeWorkspaceBase;
export const workspaceReviewUrl = (access) =>
  `${address.workspaceReviewUrl(access)}${access.schemaVersion === '2.0.0' ? '?v=2' : ''}`;
