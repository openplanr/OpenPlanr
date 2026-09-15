import {
  assertOperateReviewDisplayWorkspaceV1,
  type OperateReviewDisplayWorkspaceV1,
} from '@openplanr/protocol/dashboard/operate-review-contract.mjs';
import type { DashboardQueryRoot } from '../../../lib/api/bootstrap.js';
import { freezeDashboardWire } from '../../../lib/api/product-state.js';

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/u;
const MAX_REVIEW_BYTES = 4 * 1024 * 1024;

function reviewUrl(
  origin: string,
  root: DashboardQueryRoot,
  cycleId: string,
  reviewId: string,
): URL {
  if (!LOOPBACK.test(origin)) throw new Error('Review reads require an exact loopback origin.');
  const url = new URL(
    `/api/operate/cycles/${encodeURIComponent(cycleId)}/reviews/${encodeURIComponent(reviewId)}`,
    origin,
  );
  url.searchParams.set('scopeId', root.scopeId);
  url.searchParams.set('domainId', root.domainId);
  url.searchParams.set('domainVersion', root.domainVersion);
  return url;
}

/** Fetch exactly one owner-bound Review display workspace. */
export async function fetchOperateReviewDisplay(
  options: Readonly<{
    origin: string;
    root: DashboardQueryRoot;
    cycleId: string;
    reviewId: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<OperateReviewDisplayWorkspaceV1> {
  const response = await (options.fetcher ?? fetch)(
    reviewUrl(options.origin, options.root, options.cycleId, options.reviewId),
    {
      headers: { accept: 'application/json', 'x-openplanr-actor': options.root.actorId },
      cache: 'no-store',
      signal: options.signal,
    },
  );
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
    throw new Error('The owner-issued Review workspace is unavailable.');
  }
  const source = await response.text();
  if (new TextEncoder().encode(source).byteLength > MAX_REVIEW_BYTES) {
    throw new Error('The owner-issued Review workspace exceeds its wire limit.');
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('The owner-issued Review workspace is not JSON.');
  }
  const workspace = freezeDashboardWire(value) as OperateReviewDisplayWorkspaceV1;
  assertOperateReviewDisplayWorkspaceV1(workspace);
  assertOperateReviewDisplayWorkspaceV1(workspace, {
    actorId: options.root.actorId,
    scopeId: options.root.scopeId,
    domainId: options.root.domainId,
    domainVersion: options.root.domainVersion,
    cycleId: options.cycleId,
    reviewId: options.reviewId,
    sourceArtifactKind: workspace.payload.sourceArtifactKind,
    sourceArtifactHash: workspace.payload.sourceArtifactHash,
    sourceEventHead: workspace.payload.sourceEventHead,
    sourceReadEventHead: workspace.payload.sourceReadEventHead,
    sourceViewHash: workspace.payload.sourceViewHash,
  });
  return workspace;
}
