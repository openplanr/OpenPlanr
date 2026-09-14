import {
  assertOperateExperienceAuditDisplaySurfaceV1,
  type OperateAuditDisplayBindingV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import {
  type AccessSafeOperateSearchHitV1,
  projectAccessSafeOperateSearchHits,
} from '../../contracts/search-hit.js';
import { exactAuditEventHead } from '../../lib/binding/audit-event-head.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';

const MAX_WIRE_BYTES = 4 * 1024 * 1024;

function exactOrigin(value: string): string {
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error('OPERATE_ORIGIN_INVALID');
  }
  if (
    candidate.origin !== value ||
    candidate.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname)
  ) {
    throw new Error('OPERATE_ORIGIN_INVALID');
  }
  return candidate.origin;
}

/** Fetch owner-issued, access-safe Operate search hits for the command palette. */
export async function fetchOperateSearchHits(
  options: Readonly<{
    origin: string;
    identity: DashboardQueryIdentity;
    query?: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  }>,
): Promise<readonly AccessSafeOperateSearchHitV1[]> {
  const { identity } = options;
  if (
    identity.productArea !== 'operate' ||
    identity.cycleId === null ||
    identity.viewHash === null
  ) {
    return Object.freeze([]);
  }
  const origin = exactOrigin(options.origin);
  const query = options.query ?? '';
  if (query.length > 512) return Object.freeze([]);
  const url = new URL('/api/operate/search', origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  url.searchParams.set('cycleId', identity.cycleId);
  url.searchParams.set('q', query);
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      accept: 'application/json',
      'x-openplanr-actor': identity.actorId,
    },
    cache: 'no-store',
    signal: options.signal,
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_WIRE_BYTES) {
    throw new Error('Search response exceeds the dashboard JSON limit.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Search response is not JSON.');
  }
  if (!response.ok) return Object.freeze([]);
  try {
    const display = assertOperateExperienceAuditDisplaySurfaceV1(payload);
    const surface = display.payload;
    const auditEventHead = exactAuditEventHead(identity.eventHead);
    if (surface.surface !== 'search' || auditEventHead === null) {
      return Object.freeze([]);
    }
    const expected: OperateAuditDisplayBindingV1 = Object.freeze({
      actorId: identity.actorId,
      scopeId: identity.scopeId,
      domainId: identity.domainId,
      domainVersion: identity.domainVersion,
      cycleId: identity.cycleId,
      subjectId: null,
      surface: 'search',
      query,
      format: null,
      generatedAt: surface.generatedAt,
      eventHead: auditEventHead,
      viewHash: identity.viewHash,
    });
    assertOperateExperienceAuditDisplaySurfaceV1(display, expected);
    return projectAccessSafeOperateSearchHits(surface.data.results);
  } catch {
    return Object.freeze([]);
  }
}
