import {
  assertDiagramReviewBundle,
  assertDiagramReviewFeedback,
  assertDiagramWorkspaceContract,
  DIAGRAM_WORKSPACE_API,
  DIAGRAM_WORKSPACE_CREATE_SCHEMA,
  DIAGRAM_WORKSPACE_EVENT_SCHEMA,
  DIAGRAM_WORKSPACE_MAX_BYTES,
  DIAGRAM_WORKSPACE_MAX_EVENT_BYTES,
  DIAGRAM_WORKSPACE_REVISION_SCHEMA,
  DIAGRAM_WORKSPACE_SCHEMA,
  DIAGRAM_WORKSPACE_VERSION,
  diagramReviewBundleDigest,
} from '@openplanr/protocol/diagram-review-contracts';
import {
  assertVersionedDiagramReviewBundle,
  versionedDiagramReviewBundleDigest,
} from '@openplanr/protocol/studio-presentation-contracts';
import { createChunkedWorkspaceClient } from '../chunked-workspace-client.mjs';
import { createEncryptedWorkspaceClient } from '../encrypted-workspace-client.mjs';

export const DIAGRAM_SHARE_BASE_URL = 'https://share.openplanr.dev';
const client = createEncryptedWorkspaceClient({
  domain: 'openplanr-diagram-workspace/v1',
  apiPath: DIAGRAM_WORKSPACE_API,
  reviewPath: '/diagram',
  label: 'Diagram',
  compatibilityCode: 'E_DIAGRAM_SHARE_UNSUPPORTED',
  compatibilityMessage:
    'This sharing service does not support native diagram workspaces. Upgrade the hosted service before retrying the saved operation.',
  defaultBaseUrl: DIAGRAM_SHARE_BASE_URL,
  version: DIAGRAM_WORKSPACE_VERSION,
  maxBytes: DIAGRAM_WORKSPACE_MAX_BYTES,
  maxEventBytes: DIAGRAM_WORKSPACE_MAX_EVENT_BYTES,
  schemas: {
    create: DIAGRAM_WORKSPACE_CREATE_SCHEMA,
    event: DIAGRAM_WORKSPACE_EVENT_SCHEMA,
    revision: DIAGRAM_WORKSPACE_REVISION_SCHEMA,
    workspace: DIAGRAM_WORKSPACE_SCHEMA,
  },
  assertContract: assertDiagramWorkspaceContract,
  assertBundle: assertDiagramReviewBundle,
  assertFeedback: assertDiagramReviewFeedback,
  bundleDigest: diagramReviewBundleDigest,
});
export const {
  encodeWorkspaceBytes,
  decodeWorkspaceBytes,
  newWorkspaceToken,
  newWorkspaceId,
  normalizeWorkspaceBase,
  deriveWorkspaceAuthentication,
  canonicalWorkspacePublicKey,
  createWorkspaceSigner,
  signWorkspaceValue,
  verifyWorkspaceSignature,
} = client;

const chunked = createChunkedWorkspaceClient({
  legacy: client,
  domain: 'openplanr-diagram-workspace/v1',
  apiPath: DIAGRAM_WORKSPACE_API,
  assertBundle: assertVersionedDiagramReviewBundle,
  assertFeedback: assertDiagramReviewFeedback,
  digestInput: (bundle) => bundle,
  digestBundle: versionedDiagramReviewBundleDigest,
});
export const discoverWorkspaceCapabilities = chunked.capabilities;
export const prepareChunkedWorkspace = chunked.prepareWorkspace;
export const openWorkspaceRevision = chunked.openRevision;
export const prepareWorkspace = (bundle, options = {}) =>
  options.transport === '2'
    ? chunked.prepareWorkspace(bundle, options)
    : client.prepareWorkspace(bundle, options);
export const commitWorkspace = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).commitWorkspace(access, ...args);
export const getWorkspace = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).getWorkspace(access, ...args);
export const listWorkspaceRevisions = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).listWorkspaceRevisions(access, ...args);
export const decryptWorkspaceRevision = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).decryptWorkspaceRevision(access, ...args);
export const prepareWorkspaceMutation = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).prepareWorkspaceMutation(access, ...args);
export const commitWorkspaceMutation = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).commitWorkspaceMutation(access, ...args);
export const prepareWorkspaceEvent = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).prepareWorkspaceEvent(access, ...args);
export const appendWorkspaceEvent = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).appendWorkspaceEvent(access, ...args);
export const readWorkspaceEvents = (access, ...args) =>
  (access.schemaVersion === '2.0.0' ? chunked : client).readWorkspaceEvents(access, ...args);
export const publishWorkspace = (access, bundle, options) =>
  access.schemaVersion !== '2.0.0'
    ? client.publishWorkspace(access, bundle, options)
    : prepareWorkspaceMutation(access, 'publish', bundle).then(() =>
        commitWorkspaceMutation(access, options),
      );
export const rotateWorkspace = (access, options) =>
  access.schemaVersion !== '2.0.0'
    ? client.rotateWorkspace(access, options)
    : prepareWorkspaceMutation(access, 'rotate').then(() =>
        commitWorkspaceMutation(access, options),
      );
export const manageWorkspace = (access, action, options) =>
  access.schemaVersion !== '2.0.0'
    ? client.manageWorkspace(access, action, options)
    : prepareWorkspaceMutation(access, action).then(() => commitWorkspaceMutation(access, options));

export const workspaceEnvelopeDigest = versionedDiagramReviewBundleDigest;

export const workspaceReviewUrl = (access) =>
  `${client.workspaceReviewUrl(access)}${access.schemaVersion === '2.0.0' ? '?v=2' : ''}`;
