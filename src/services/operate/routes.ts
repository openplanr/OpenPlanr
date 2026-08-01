import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderTemplate } from '../template-service.js';
import {
  createOperatingArtifactGenerationPlan,
  generatedArtifactWrites,
  generateOperatingRouteArtifact,
  type OperatingArtifactGenerationPlan,
  type OperatingArtifactGeneratorAdapter,
  readStoredOperatingArtifactGeneration,
  resolveOperatingArtifactGenerator,
  type StoredOperatingArtifactGeneration,
} from './artifact-route-generation.js';
import { canonicalDigest, canonicalize, sha256Digest } from './canonical.js';
import { operatingProjectKey, validateOperatingConfiguration } from './config.js';
import { semanticallyEquivalentFindings } from './consolidation.js';
import { type AppendOperatingEventInput, OperatingEventStore } from './event-store.js';
import {
  applyJournalTransaction,
  prepareJournalTransaction,
  readJournal,
  rollbackJournalTransaction,
} from './journal.js';
import { type OperatingLock, withOperatingLock } from './lock-service.js';
import {
  assertPlanningProducer,
  completePipelinePoHandoff,
  hasPipelinePoCompletionProvenance,
  inspectPlanningProducer,
  loadPipelinePoBridge,
  type PipelinePoHandoff,
  preparePipelinePoHandoff,
} from './pipeline-handoff.js';
import { persistOperatingProjections } from './projection-persistence.js';
import { assertOperatingArtifact } from './protocol.js';
import { sanitizeGeneratedPlainText } from './redaction.js';
import {
  OPERATE_MISSION_PROTOCOL_VERSION,
  OPERATE_PROTOCOL_VERSION,
  OPERATE_SCHEMA_VERSION,
  OperateError,
  type OperatingArtifactSession,
  type OperatingConfig,
  type OperatingEvent,
  type OperatingEventHead,
  type OperatingFinding,
  type OperatingOutcome,
  type OperatingRouteAction,
  type OperatingRoutePlan,
  type OperatingState,
  type OperatingWorkspaceManifest,
} from './types.js';
import {
  refreshOperatingWorkspaceManifest,
  resolveContainedPath,
  resolveOperatingPaths,
} from './workspace.js';

const ROUTE_MANAGED_WORKSPACE_PATHS = [
  '.planr/specs',
  '.planr/quick',
  '.planr/provenance.jsonl',
] as const;

/**
 * A DEV-lane finding is "small, bounded implementation work" — routable to the
 * quick-task delivery surface instead of a full reviewed SPEC — when it is
 * low-risk (`severity: 'low'`), easy (`ease >= 4`), and small in blast radius
 * (`impact <= 2`). Anything heavier stays on `create-spec`. Instrumentation is
 * still classified ahead of this by `actionKind`.
 */
function isSmallBoundedImplementation(finding: OperatingFinding): boolean {
  return (
    finding.lane === 'DEV' &&
    !finding.category.includes('instrument') &&
    finding.severity === 'low' &&
    finding.ease >= 4 &&
    finding.impact <= 2
  );
}

function actionKind(finding: OperatingFinding, isEpicAnchor = false): OperatingRouteAction['kind'] {
  // Consolidation-level grouping elects `create-epic` first: when this finding
  // is the anchor of a 2+-member group of related accepted findings, the whole
  // theme routes to one epic (the anchor is carried in `findingId`; the full
  // member-finding list lives in the generated epic markdown, per clarifications
  // Option A). Every single-finding lane classification below is unchanged.
  if (isEpicAnchor) return 'create-epic';
  if (finding.lane === 'OWNER') return 'create-decision';
  if (finding.lane === 'AGENT') return 'create-cycle-artifact';
  if (finding.category.includes('instrument')) return 'create-instrumentation-spec';
  if (isSmallBoundedImplementation(finding)) return 'create-quick-task';
  return 'create-spec';
}

/**
 * A single member of a grouped-finding epic. Only the fields needed to render
 * the epic markdown are carried; the shared v1.3 route-plan schema stays
 * single-`findingId` (the anchor) — this list is an OpenPlanr-local planning
 * detail recorded in the epic document, never a protocol-schema field.
 */
export interface EpicFindingMember {
  id: string;
  title: string;
  problem: string;
  proposal: string;
  evidenceRefs: string[];
}

/**
 * A consolidation-level grouping of 2+ related accepted findings that routes to
 * one `create-epic` action. `anchorId` is the lexicographically-first member id
 * (carried as the route action's single `findingId`); `members` (sorted by id)
 * is embedded verbatim in the generated epic markdown so finding → epic → spec
 * provenance stays traceable without a new protocol sidecar.
 */
export interface EpicFindingGroup {
  anchorId: string;
  memberIds: string[];
  members: EpicFindingMember[];
  category: string;
  theme: string;
  evidenceRefs: string[];
}

interface GroupableFinding {
  id: string;
  status?: unknown;
  category?: unknown;
  title?: unknown;
  problem?: unknown;
  proposal?: unknown;
  fingerprint?: unknown;
  sensitivity?: unknown;
  evidenceRefs?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function evidenceRefList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))].sort()
    : [];
}

function toEpicMember(finding: GroupableFinding): EpicFindingMember {
  return {
    id: finding.id,
    title: text(finding.title) || finding.id,
    problem: text(finding.problem),
    proposal: text(finding.proposal),
    evidenceRefs: evidenceRefList(finding.evidenceRefs),
  };
}

const EPIC_THEME_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'for',
  'in',
  'on',
  'with',
  'is',
  'are',
  'be',
  'from',
  'by',
  'that',
  'this',
  'it',
  'its',
]);

function themeWords(title: string): string[] {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !EPIC_THEME_STOP_WORDS.has(word));
}

/** Deterministic, human-legible epic title derived from the members' shared words. */
function deriveEpicTheme(members: EpicFindingMember[], category: string): string {
  const counts = new Map<string, number>();
  for (const member of members) {
    for (const word of new Set(themeWords(member.title))) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const anchorOrder = themeWords(members[0]?.title ?? '');
  const shared = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([word]) => word)
    .sort((left, right) => {
      const leftIndex = anchorOrder.indexOf(left);
      const rightIndex = anchorOrder.indexOf(right);
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
          (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex) || left.localeCompare(right)
      );
    })
    .slice(0, 5);
  const focus = shared.length > 0 ? shared.join(' ') : `related ${category}`;
  const capped = focus.charAt(0).toUpperCase() + focus.slice(1);
  return `${capped} (${members.length} related findings)`;
}

/**
 * Group related accepted findings into epic candidates. Two accepted findings
 * are related when they share a non-empty normalized `category`, share the same
 * evidence-derived `fingerprint` lineage, or are semantically equivalent per
 * `consolidation.ts` (which subsumes the Chair merge-proposal source, since a
 * merged finding keeps that shared category/fingerprint). Only components of 2+
 * members become epic groups; every group is deterministic (union-find over
 * id-sorted findings), so the FR7 report suggestion and the FR8 engine route
 * elect exactly the same theme.
 */
export function groupRelatedAcceptedFindings(findings: GroupableFinding[]): EpicFindingGroup[] {
  const accepted = findings
    .filter((finding) => text(finding.category).trim().length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const parent = accepted.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left: number, right: number): void => {
    const [keep, drop] = [find(left), find(right)].sort((a, b) => a - b);
    if (keep !== drop) parent[drop] = keep;
  };
  const related = (left: GroupableFinding, right: GroupableFinding): boolean => {
    const leftCategory = text(left.category).trim().toLowerCase();
    const rightCategory = text(right.category).trim().toLowerCase();
    if (leftCategory && leftCategory === rightCategory) return true;
    const leftPrint = text(left.fingerprint);
    if (leftPrint && leftPrint === text(right.fingerprint)) return true;
    return semanticallyEquivalentFindings(
      {
        category: text(left.category),
        title: text(left.title),
        problem: text(left.problem),
        proposal: text(left.proposal),
        sensitivity: (text(left.sensitivity) || 'internal') as OperatingFinding['sensitivity'],
      },
      {
        category: text(right.category),
        title: text(right.title),
        problem: text(right.problem),
        proposal: text(right.proposal),
        sensitivity: (text(right.sensitivity) || 'internal') as OperatingFinding['sensitivity'],
      },
    );
  };
  for (let left = 0; left < accepted.length; left += 1) {
    for (let right = left + 1; right < accepted.length; right += 1) {
      if (related(accepted[left], accepted[right])) union(left, right);
    }
  }
  const clusters = new Map<number, GroupableFinding[]>();
  accepted.forEach((finding, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) ?? []), finding]);
  });
  return [...clusters.values()]
    .filter((cluster) => cluster.length >= 2)
    .map((cluster) => {
      const members = cluster
        .map(toEpicMember)
        .sort((left, right) => left.id.localeCompare(right.id));
      const category = text(cluster[0].category);
      return {
        anchorId: members[0].id,
        memberIds: members.map((member) => member.id),
        members,
        category,
        theme: deriveEpicTheme(members, category),
        evidenceRefs: [...new Set(members.flatMap((member) => member.evidenceRefs))].sort(),
      } satisfies EpicFindingGroup;
    })
    .sort((left, right) => left.anchorId.localeCompare(right.anchorId));
}

/**
 * Resolve the epic group anchored by `anchorId` from the committed accepted
 * findings of a cycle. Reading the projected event store (not caller-passed
 * state) is what keeps preview (`createOperatingRoutePlan`) and apply
 * (`applyOperatingRoute`) byte-identical: both rebuild the same member list from
 * the same accepted-finding set. Returns `null` when the anchor no longer heads
 * a 2+-member group, which correctly surfaces as route drift on apply.
 */
async function resolveEpicGroupForAnchor(input: {
  projectRoot: string;
  localRoot?: string;
  cycleId: string;
  anchorId: string;
}): Promise<EpicFindingGroup | null> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const state = await store.state();
  const acceptedFindings = state.findings.filter(
    (finding) => finding.status === 'accepted' && finding.cycleId === input.cycleId,
  ) as unknown as GroupableFinding[];
  return (
    groupRelatedAcceptedFindings(acceptedFindings).find(
      (group) => group.anchorId === input.anchorId,
    ) ?? null
  );
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'operating-action'
  );
}

export async function nextOperatingSpecOrdinal(projectRoot: string): Promise<number> {
  const root = path.join(projectRoot, '.planr', 'specs');
  let maximum = 0;
  for (const name of await readdir(root).catch(() => [])) {
    const match = name.match(/^SPEC-(\d+)(?:-|$)/);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum + 1;
}

export async function nextOperatingEpicOrdinal(projectRoot: string): Promise<number> {
  const root = path.join(projectRoot, '.planr', 'epics');
  let maximum = 0;
  for (const name of await readdir(root).catch(() => [])) {
    const match = name.match(/^EPIC-(\d+)(?:-|$)/);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum + 1;
}

function routeDestinationPaths(route: OperatingRoutePlan): string[] {
  const action = route.actions[0];
  if (!action?.targetPath) return [];
  if (action.kind === 'create-spec' || action.kind === 'create-instrumentation-spec') {
    const specId = action.targetPath.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
    if (!specId) return [action.targetPath];
    const ordinal = specId.slice('SPEC-'.length);
    return [
      action.targetPath,
      `.planr/operate/spec-links/${specId}.json`,
      `.planr/operate/outcomes/OUT-${ordinal}.json`,
      `.planr/operate/handoffs/${route.id}.json`,
    ];
  }
  if (action.kind === 'create-cycle-artifact') {
    const artifactId = `ART-${route.id.slice('ACT-'.length)}`;
    return [
      action.targetPath,
      `${path.posix.dirname(action.targetPath)}/${artifactId}.session.json`,
    ];
  }
  if (action.kind === 'create-epic') {
    // Provenance threads forward through the epic id encoded in `targetPath`
    // (the same id-in-destination pattern the `create-spec` branch above uses),
    // not a new protocol sidecar: the full member-finding list lives inside the
    // generated epic markdown, so the single epic file is the only destination.
    return [action.targetPath];
  }
  return [action.targetPath];
}

export async function createOperatingRoutePlan(input: {
  projectRoot: string;
  cycleId: string;
  finding: OperatingFinding;
  config: OperatingConfig;
  workspace: OperatingWorkspaceManifest;
  eventHead: OperatingEventHead;
  evidenceDigest: `sha256:${string}`;
  providerDigest: `sha256:${string}`;
  sequence: number;
  specId?: string;
  epicId?: string;
  localRoot?: string;
  now?: string;
}): Promise<OperatingRoutePlan> {
  const now = input.now ?? new Date().toISOString();
  const id = `ACT-${String(input.sequence).padStart(3, '0')}`;
  // Epic election only fires for an already-accepted anchor finding — the engine
  // creates routes from freshly-proposed findings, so this is skipped there (no
  // store read, unchanged behavior); a caller that has accepted a related group
  // reaches it. The member list is rebuilt from the committed accepted findings.
  const epicGroup =
    input.finding.status === 'accepted'
      ? await resolveEpicGroupForAnchor({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          cycleId: input.cycleId,
          anchorId: input.finding.id,
        })
      : null;
  const kind = actionKind(input.finding, Boolean(epicGroup));
  const epicId =
    kind === 'create-epic'
      ? (input.epicId ??
        `EPIC-${String(await nextOperatingEpicOrdinal(input.projectRoot)).padStart(3, '0')}`)
      : null;
  const slug = slugify(kind === 'create-epic' && epicGroup ? epicGroup.theme : input.finding.title);
  const targetPath =
    kind === 'create-spec' || kind === 'create-instrumentation-spec'
      ? `.planr/specs/${input.specId ?? `SPEC-${String(input.sequence).padStart(3, '0')}`}-${slug}/${input.specId ?? `SPEC-${String(input.sequence).padStart(3, '0')}`}-${slug}.md`
      : kind === 'create-cycle-artifact'
        ? `.planr/operate/cycles/${input.cycleId}/artifacts/ART-${id.slice('ACT-'.length)}-${slug}.md`
        : kind === 'create-quick-task'
          ? `.planr/quick/QUICK-${id.slice('ACT-'.length)}-${slug}.md`
          : kind === 'create-epic'
            ? `.planr/epics/${epicId}-${slug}.md`
            : `.planr/operate/decisions/${id}.json`;
  // A quick-task or epic route validates against the additive v1.3 route-plan
  // schema — the only route-plan schema whose kind enum includes
  // `create-quick-task`/`create-epic`. Every other kind keeps the frozen v1.2
  // envelope untouched.
  const protocolVersion =
    kind === 'create-quick-task' || kind === 'create-epic'
      ? OPERATE_MISSION_PROTOCOL_VERSION
      : OPERATE_PROTOCOL_VERSION;
  const action: OperatingRouteAction = {
    id,
    findingId: input.finding.id,
    lane: input.finding.lane,
    owner: input.finding.owner,
    kind,
    dependsOn: [],
    // An epic route carries the anchor finding as `findingId` but cites the whole
    // group's evidence (union), so the single reviewable route covers every
    // member's citations; other kinds keep the finding's own refs.
    evidenceRefs:
      kind === 'create-epic' && epicGroup
        ? epicGroup.evidenceRefs
        : [...input.finding.evidenceRefs].sort(),
    reversible: true,
    requiresConfirmation: true,
    targetPath,
  };
  const routeWorkspace = await refreshOperatingWorkspaceManifest(input.projectRoot, {
    localRoot: input.localRoot,
    ignoredControlPaths: [...ROUTE_MANAGED_WORKSPACE_PATHS],
  });
  const destinationShape = {
    actions: [action],
    id,
  } as OperatingRoutePlan;
  const destinationDigest = canonicalDigest(
    routeDestinationPaths(destinationShape).map((destination) => ({
      path: destination,
      beforeDigest: null,
    })),
  );
  const inputDigest = canonicalDigest({
    project: routeWorkspace.workspaceDigest,
    cycleId: input.cycleId,
    findingId: input.finding.id,
    evidenceHead: input.evidenceDigest,
    eventHead: input.eventHead,
    providerPolicy: input.providerDigest,
    destinations: destinationDigest,
    actions: [action],
    planningEngine: input.config.planningEngine,
  });
  const provisional: OperatingRoutePlan = {
    kind: 'operating-route-plan',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion,
    id,
    cycleId: input.cycleId,
    inputDigest,
    routeDigest: `sha256:${'0'.repeat(64)}`,
    previewDigest: `sha256:${'0'.repeat(64)}`,
    workspaceDigest: routeWorkspace.workspaceDigest,
    evidenceDigest: input.evidenceDigest,
    providerDigest: input.providerDigest,
    destinationDigest,
    eventHead: structuredClone(input.eventHead),
    state: 'proposed',
    actions: [action],
    createdAt: now,
  };
  const plannedWrites = await buildRouteWrites({
    projectRoot: input.projectRoot,
    route: provisional,
    finding: input.finding as unknown as Record<string, unknown>,
    config: input.config,
    now,
    localRoot: input.localRoot,
  });
  const previewDigest = routeWritesPreviewDigest(
    inputDigest,
    plannedWrites.writes,
    plannedWrites.generationPlan?.planDigest,
  );
  const routeDigest = canonicalDigest({
    id,
    cycleId: input.cycleId,
    inputDigest,
    previewDigest,
    workspaceDigest: routeWorkspace.workspaceDigest,
    evidenceDigest: input.evidenceDigest,
    providerDigest: input.providerDigest,
    destinationDigest,
    eventHead: input.eventHead,
    actions: [action],
  });
  const route: OperatingRoutePlan = {
    kind: 'operating-route-plan',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion,
    id,
    cycleId: input.cycleId,
    inputDigest,
    routeDigest,
    previewDigest,
    workspaceDigest: routeWorkspace.workspaceDigest,
    evidenceDigest: input.evidenceDigest,
    providerDigest: input.providerDigest,
    destinationDigest,
    eventHead: structuredClone(input.eventHead),
    state: 'proposed',
    actions: [action],
    createdAt: now,
  };
  return assertOperatingArtifact('operating-route-plan', route);
}

/**
 * Every finding id a `create-epic` route was ever proposed against. Mirrors the
 * engine's `existingRoutedFindingIds`, but scoped to epic routes only, so epic
 * election is idempotent: a group whose anchor already heads a committed epic
 * route is never re-elected, no matter how many of its members are later
 * accepted.
 */
function existingEpicRouteFindingIds(events: OperatingEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== 'route.proposed') continue;
    const record = event.payload.record as
      | { actions?: Array<{ kind?: unknown; findingId?: unknown }> }
      | undefined;
    if (!record || typeof record !== 'object') continue;
    for (const action of record.actions ?? []) {
      if (action.kind === 'create-epic' && typeof action.findingId === 'string') {
        ids.add(action.findingId);
      }
    }
  }
  return ids;
}

function maximumRouteOrdinal(routes: Array<{ id?: unknown }>): number {
  let maximum = 0;
  for (const route of routes) {
    const match = typeof route.id === 'string' ? /^ACT-(\d+)$/.exec(route.id) : null;
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum;
}

/**
 * Bind an elected epic route to the same evidence/provider state the cycle's
 * other routes already carry, so its provenance is consistent with the DEV/OWNER
 * routes the same accepted findings produced. A group's members were routed on
 * proposal, so a reference route always exists; the offline fallback only guards
 * the theoretical no-prior-route case (neither digest is re-derived at apply, so
 * any self-consistent binding is valid).
 */
async function referenceCycleRouteDigests(
  projectRoot: string,
  state: OperatingState,
  cycleId: string,
): Promise<{ evidenceDigest: `sha256:${string}`; providerDigest: `sha256:${string}` }> {
  for (const projected of state.routes) {
    if (String(projected.cycleId) !== cycleId) continue;
    const route = await readOperatingRoute(projectRoot, String(projected.id)).catch(() => null);
    if (route?.evidenceDigest && route?.providerDigest) {
      return { evidenceDigest: route.evidenceDigest, providerDigest: route.providerDigest };
    }
  }
  const offline = canonicalDigest({ provider: 'offline' });
  return { evidenceDigest: offline, providerDigest: offline };
}

async function appendRouteEvent(
  store: OperatingEventStore,
  lock: OperatingLock,
  head: OperatingEventHead,
  input: Omit<AppendOperatingEventInput, 'expectedHead'>,
): Promise<OperatingEventHead> {
  const event = await store.append({
    ...input,
    actor: input.actor ?? { kind: 'human', id: 'operate-cli' },
    expectedHead: head.hash,
  });
  const next = { sequence: event.sequence, hash: event.eventHash };
  await lock.advanceEventHead(head, next);
  return next;
}

/**
 * Write a proposed route file through the write-ahead journal and append its
 * `route.proposed` event, exactly the way the engine proposes a freshly-elected
 * route (recoverable orphaned-proposal handling included), so an epic route
 * elected at acceptance time is indistinguishable from an engine-proposed one.
 */
async function commitProposedRoute(
  store: OperatingEventStore,
  lock: OperatingLock,
  projectRoot: string,
  localRoot: string | undefined,
  route: OperatingRoutePlan,
  head: OperatingEventHead,
): Promise<OperatingEventHead> {
  const relativePath = `.planr/operate/routes/${route.id}.json`;
  const content = `${canonicalize(route)}\n`;
  const transactionId = `TXN-${route.cycleId}-${route.id}-proposal`;
  const transactionRoot = path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).transactions,
    transactionId,
  );
  const manifestPath = path.join(transactionRoot, 'journal.json');
  const existingBytes = await readFile(path.join(projectRoot, relativePath), 'utf8').catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    },
  );
  const journal =
    existingBytes === null
      ? await prepareJournalTransaction(projectRoot, {
          writes: [{ relativePath, operation: 'create' as const, content }],
          eventHead: head,
          previewDigest: route.previewDigest,
          transactionId,
          localRoot,
        })
      : { root: transactionRoot, manifestPath, record: await readJournal(manifestPath) };
  if (existingBytes !== null) {
    if (
      existingBytes !== content ||
      journal.record.state !== 'committed' ||
      journal.record.previewDigest !== route.previewDigest
    ) {
      throw new OperateError(
        'E_OPERATE_TRANSACTION_INVALID',
        `Orphaned epic route proposal ${route.id} does not match its committed journal.`,
      );
    }
  } else {
    await applyJournalTransaction(projectRoot, journal, {
      currentEventHead: head,
      revalidateEventHead: async () => (await store.replay()).eventHead,
    });
  }
  try {
    await store.putRecord('route', structuredClone(route) as unknown as Record<string, unknown>, {
      correlationId: route.cycleId,
      createdAt: route.createdAt,
    });
    return await appendRouteEvent(store, lock, head, {
      type: 'route.proposed',
      cycleId: route.cycleId,
      entityId: route.id,
      evidenceRefs: route.actions.flatMap((action) => action.evidenceRefs),
      payload: { record: route },
      // A v1.3 (create-epic) route plan embedded in the event payload stamps the
      // event v1.3, whose schema accepts either route-plan version.
      ...(route.protocolVersion === OPERATE_MISSION_PROTOCOL_VERSION
        ? { protocolVersion: OPERATE_MISSION_PROTOCOL_VERSION }
        : {}),
    });
  } catch (error) {
    await rollbackJournalTransaction(projectRoot, journal).catch(() => undefined);
    throw error;
  }
}

/**
 * Re-evaluate a cycle's accepted findings for epic election and PROPOSE + accept
 * one governed `create-epic` route per themed 2+-member group that does not yet
 * have one. This is the operator-reachable producer of FR8 epic routes: it runs
 * right after a finding transitions to `accepted` through `governOperatingFinding`,
 * so accepting a related group yields a `create-epic` route through the same
 * journal-backed proposal path the engine uses for freshly-proposed findings —
 * reusing T-006's `groupRelatedAcceptedFindings`/`resolveEpicGroupForAnchor`/
 * `actionKind` so FR7's rendered suggestion and FR8's route always name the same
 * theme.
 *
 * Election never writes the epic markdown and never applies the route (accept ≠
 * apply): it only proposes the route and accepts it — mirroring exactly how
 * governance accepts a finding's individual route — leaving the digest-bound,
 * human-gated `routes apply` as the separate acting step. It is idempotent: a
 * group whose anchor already heads a committed `create-epic` route is skipped, so
 * re-electing (accepting further members of the same theme) never duplicates the
 * epic route. Membership growth before apply fails CLOSED rather than silently
 * writing a different epic: `resolveEpicGroupForAnchor` re-derives the member
 * list from the then-current accepted findings, so a route proposed for {A,B}
 * whose group has grown to {A,B,C} no longer matches its digest-bound preview
 * and `applyOperatingRoute` rejects it with `E_OPERATE_ROUTE_DRIFT` — the same
 * guard every other route kind carries. An individually-routed finding is never
 * re-routed individually — only the group-level epic route is added.
 */
export async function electAcceptedFindingEpicRoutes(input: {
  projectRoot: string;
  localRoot?: string;
  cycleId: string;
  now?: string;
}): Promise<OperatingRoutePlan[]> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  const state = await store.state();
  const acceptedFindings = state.findings.filter(
    (finding) => finding.status === 'accepted' && String(finding.cycleId) === input.cycleId,
  ) as unknown as GroupableFinding[];
  const candidateGroups = groupRelatedAcceptedFindings(acceptedFindings);
  if (candidateGroups.length === 0) return [];
  const routedForEpic = existingEpicRouteFindingIds(initial.events);
  const pending = candidateGroups.filter(
    (group) => !group.memberIds.some((memberId) => routedForEpic.has(memberId)),
  );
  if (pending.length === 0) return [];

  const config = await validateOperatingConfiguration(input.projectRoot);
  const reference = await referenceCycleRouteDigests(input.projectRoot, state, input.cycleId);
  const now = input.now ?? new Date().toISOString();

  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const lockedReplay = await store.replay();
      lock.assertEventHead(lockedReplay.eventHead);
      const lockedState = await store.state();
      // Recompute idempotence + ordinals under the lock so two concurrent
      // acceptances can never both elect the same group or collide on ids.
      const alreadyRouted = existingEpicRouteFindingIds(lockedReplay.events);
      const anchorFindings = new Map(
        lockedState.findings.map((finding) => [finding.id, finding as unknown as OperatingFinding]),
      );
      const workspace = await refreshOperatingWorkspaceManifest(input.projectRoot, {
        localRoot: input.localRoot,
        ignoredControlPaths: [...ROUTE_MANAGED_WORKSPACE_PATHS],
      });
      let head = lockedReplay.eventHead;
      let routeOrdinal = maximumRouteOrdinal(lockedState.routes);
      let epicOrdinal = await nextOperatingEpicOrdinal(input.projectRoot);
      const elected: OperatingRoutePlan[] = [];
      for (const group of pending) {
        if (group.memberIds.some((memberId) => alreadyRouted.has(memberId))) continue;
        const anchor = anchorFindings.get(group.anchorId);
        if (!anchor || anchor.status !== 'accepted') continue;
        const route = await createOperatingRoutePlan({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          cycleId: input.cycleId,
          finding: anchor,
          config,
          workspace,
          eventHead: head,
          evidenceDigest: reference.evidenceDigest,
          providerDigest: reference.providerDigest,
          sequence: ++routeOrdinal,
          epicId: `EPIC-${String(epicOrdinal).padStart(3, '0')}`,
          now,
        });
        // Defensive: the pending filter already guarantees a 2+-member group, so
        // the anchor elects `create-epic`. Skip rather than mis-propose otherwise.
        if (route.actions[0]?.kind !== 'create-epic') continue;
        epicOrdinal += 1;
        head = await commitProposedRoute(
          store,
          lock,
          input.projectRoot,
          input.localRoot,
          route,
          head,
        );
        // Accept the elected route exactly the way governance accepts a finding's
        // individual route (proposed → accepted, apply-ready) — never applied, so
        // accept ≠ apply holds: no epic bytes and no route.applied are written here.
        head = await appendRouteEvent(store, lock, head, {
          type: 'route.accepted',
          cycleId: input.cycleId,
          entityId: route.id,
          evidenceRefs: route.actions.flatMap((action) => action.evidenceRefs),
          payload: { routeDigest: route.routeDigest, confirmationDigest: route.previewDigest },
        });
        for (const memberId of group.memberIds) alreadyRouted.add(memberId);
        elected.push(route);
      }
      if (elected.length === 0) return [];
      const finalState = await store.state();
      await store.writeCheckpoint(finalState);
      await persistOperatingProjections({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        state: finalState,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return elected;
    },
  );
}

async function assertRouteWorkspaceCurrent(input: {
  projectRoot: string;
  localRoot?: string;
  route: OperatingRoutePlan;
}): Promise<void> {
  const observed = await refreshOperatingWorkspaceManifest(input.projectRoot, {
    localRoot: input.localRoot,
    ignoredControlPaths: [...ROUTE_MANAGED_WORKSPACE_PATHS],
  });
  if (observed.workspaceDigest !== input.route.workspaceDigest) {
    throw new OperateError(
      'E_OPERATE_HEAD_DIVERGED',
      'Workspace revisions, branches, remotes, or material dirty fingerprints changed after the route preview.',
      {
        expectedWorkspaceDigest: input.route.workspaceDigest,
        actualWorkspaceDigest: observed.workspaceDigest,
      },
    );
  }
}

export async function readOperatingRoute(
  projectRoot: string,
  routeId: string,
): Promise<OperatingRoutePlan> {
  const target = path.join(resolveOperatingPaths(projectRoot).routes, `${routeId}.json`);
  const route = JSON.parse(await readFile(target, 'utf8')) as OperatingRoutePlan;
  return assertOperatingArtifact('operating-route-plan', route);
}

interface OperatingSpecLink {
  kind: 'operating-spec-link';
  schemaVersion: typeof OPERATE_SCHEMA_VERSION;
  protocolVersion: typeof OPERATE_PROTOCOL_VERSION;
  specId: string;
  sourceCycle: string;
  sourceFinding: string;
  planningEngine: 'openplanr' | 'pipeline-po';
  evidenceRefs: string[];
  outcome: {
    kind: 'metric' | 'guardrail' | 'operational';
    metric: string;
    unit: string;
    queryIdentity: string;
    direction: 'increase';
    operator: 'gte';
    aggregation: 'latest';
    baselineWindow: { from: string; to: string };
    targetWindow: { from: string; to: string };
    threshold: { value: number };
    minimumCoverage: number;
    minimumSample: number;
    stalePolicy: 'create-gap';
    missingPolicy: 'create-gap';
    guardrailPrecedence: 'block-on-breach';
    source: string;
    observationWindow: string;
    verifyAfter: string;
  };
  guardrails: string[];
  rollout: string;
  rollback: string;
}

interface BuiltRouteWrites {
  writes: Array<{
    relativePath: string;
    operation: 'create';
    content: string;
  }>;
  specLink?: OperatingSpecLink;
  outcome?: OperatingOutcome;
  artifactSession?: OperatingArtifactSession;
  generationPlan?: OperatingArtifactGenerationPlan;
}

interface StoredPlanningHandoff {
  kind: 'operating-planning-handoff';
  routeId: string;
  transactionId: string;
  cycleId: string;
  specId: string;
  feature: string;
  targetPath: string;
  planningEngine: 'openplanr' | 'pipeline-po';
  runtime: string;
  invocation: string;
  state: 'awaiting-plan';
  inputDigest: `sha256:${string}`;
  prepared: PipelinePoHandoff | null;
  shipInvoked: false;
  createdAt: string;
}

function localPlanningHandoffPath(
  projectRoot: string,
  routeId: string,
  localRoot?: string,
): string {
  return path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
    'planning-handoffs',
    `${routeId}.json`,
  );
}

async function readOperatingRuntime(projectRoot: string, localRoot?: string): Promise<string> {
  const target = path.join(
    resolveOperatingPaths(projectRoot, { localRoot }).localRoot,
    'preferences.json',
  );
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as { runtime?: unknown };
    return typeof parsed.runtime === 'string' && parsed.runtime.trim() ? parsed.runtime : 'auto';
  } catch {
    return 'auto';
  }
}

function validateStoredPlanningHandoff(
  value: unknown,
  expected: {
    route: OperatingRoutePlan;
    transactionId: string;
    planningEngine: 'openplanr' | 'pipeline-po';
  },
): StoredPlanningHandoff {
  const handoff = value as Partial<StoredPlanningHandoff>;
  if (
    !handoff ||
    handoff.kind !== 'operating-planning-handoff' ||
    handoff.routeId !== expected.route.id ||
    handoff.transactionId !== expected.transactionId ||
    handoff.cycleId !== expected.route.cycleId ||
    handoff.planningEngine !== expected.planningEngine ||
    handoff.inputDigest !== expected.route.inputDigest ||
    handoff.state !== 'awaiting-plan' ||
    handoff.shipInvoked !== false ||
    typeof handoff.specId !== 'string' ||
    typeof handoff.feature !== 'string' ||
    typeof handoff.targetPath !== 'string' ||
    typeof handoff.runtime !== 'string' ||
    typeof handoff.invocation !== 'string' ||
    typeof handoff.createdAt !== 'string'
  ) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The machine-local planning handoff does not match the accepted route.',
    );
  }
  if (
    expected.planningEngine === 'pipeline-po' &&
    (!handoff.prepared ||
      handoff.prepared.planningEngine !== 'pipeline-po' ||
      canonicalDigest(handoff.prepared.prepared) !== handoff.prepared.preparedDigest ||
      handoff.prepared.shipInvoked !== false)
  ) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The pipeline PO handoff digest is invalid.',
    );
  }
  if (expected.planningEngine === 'openplanr' && handoff.prepared !== null) {
    throw new OperateError(
      'E_OPERATE_PLANNER_CONFLICT',
      'The OpenPlanr handoff contains an unexpected pipeline preparation.',
    );
  }
  return handoff as StoredPlanningHandoff;
}

async function ensurePlanningHandoff(input: {
  projectRoot: string;
  localRoot?: string;
  route: OperatingRoutePlan;
  config: OperatingConfig;
  finding: Record<string, unknown>;
  transactionId: string;
}): Promise<StoredPlanningHandoff> {
  const action = input.route.actions[0];
  const targetPath = path.posix.dirname(action.targetPath as string);
  const specId = action.targetPath?.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
  if (!specId) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      'DEV route target does not encode a canonical SPEC id.',
    );
  }
  const target = localPlanningHandoffPath(input.projectRoot, input.route.id, input.localRoot);
  const existing = await readFile(target, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (existing) {
    return validateStoredPlanningHandoff(JSON.parse(existing), {
      route: input.route,
      transactionId: input.transactionId,
      planningEngine: input.config.planningEngine,
    });
  }
  await assertPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath,
    selected: input.config.planningEngine,
  });
  const runtime = await readOperatingRuntime(input.projectRoot, input.localRoot);
  const feature = slugify(String(input.finding.title ?? action.findingId));
  const prepared =
    input.config.planningEngine === 'pipeline-po'
      ? await preparePipelinePoHandoff({
          bridge: await loadPipelinePoBridge(),
          projectRoot: input.projectRoot,
          feature,
          runtime,
          runId: `operate-${input.route.id.toLowerCase()}`,
          targetPath,
        })
      : null;
  const handoff: StoredPlanningHandoff = {
    kind: 'operating-planning-handoff',
    routeId: input.route.id,
    transactionId: input.transactionId,
    cycleId: input.route.cycleId,
    specId,
    feature,
    targetPath,
    planningEngine: input.config.planningEngine,
    runtime,
    invocation: prepared?.invocation ?? `planr spec decompose ${JSON.stringify(specId)}`,
    state: 'awaiting-plan',
    inputDigest: input.route.inputDigest,
    prepared,
    shipInvoked: false,
    createdAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${input.route.id}.tmp`;
  await writeFile(temporary, `${canonicalize(handoff)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return handoff;
}

async function completePlanningHandoffIfReady(input: {
  projectRoot: string;
  handoff: StoredPlanningHandoff;
}): Promise<boolean> {
  const inspection = await inspectPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath: input.handoff.targetPath,
  });
  if (!inspection.populated) return false;
  await assertPlanningProducer({
    projectRoot: input.projectRoot,
    targetPath: input.handoff.targetPath,
    selected: input.handoff.planningEngine,
  });
  if (input.handoff.planningEngine === 'pipeline-po') {
    const completionRecorded = await hasPipelinePoCompletionProvenance({
      projectRoot: input.projectRoot,
      targetPath: input.handoff.targetPath,
      runId: input.handoff.prepared?.runId ?? input.handoff.transactionId,
    });
    if (!completionRecorded) {
      await completePipelinePoHandoff({
        bridge: await loadPipelinePoBridge(),
        projectRoot: input.projectRoot,
        runtime: input.handoff.runtime,
        handoff: input.handoff.prepared as PipelinePoHandoff,
        nativePlanCompleted: true,
      });
    }
    await assertPlanningProducer({
      projectRoot: input.projectRoot,
      targetPath: input.handoff.targetPath,
      selected: 'pipeline-po',
    });
    if (
      !(await hasPipelinePoCompletionProvenance({
        projectRoot: input.projectRoot,
        targetPath: input.handoff.targetPath,
        runId: input.handoff.prepared?.runId ?? input.handoff.transactionId,
      }))
    ) {
      throw new OperateError(
        'E_OPERATE_PLANNER_CONFLICT',
        'Pipeline PO completion did not record the expected route-bound provenance.',
      );
    }
  }
  return true;
}

function routeWritesPreviewDigest(
  inputDigest: `sha256:${string}`,
  writes: BuiltRouteWrites['writes'],
  generationPlanDigest?: `sha256:${string}`,
): `sha256:${string}` {
  return canonicalDigest({
    inputDigest,
    generationPlanDigest: generationPlanDigest ?? null,
    writes: writes.map((write) => ({
      path: write.relativePath,
      operation: write.operation,
      contentDigest: sha256Digest(write.content),
    })),
  });
}

async function routeWriteMaterialState(
  projectRoot: string,
  writes: BuiltRouteWrites['writes'],
): Promise<'absent' | 'exact'> {
  const observed = await Promise.all(
    writes.map(async (write) => {
      const target = await resolveContainedPath(projectRoot, write.relativePath);
      const bytes = await readFile(target).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (!bytes) return 'absent' as const;
      return sha256Digest(bytes) === sha256Digest(write.content)
        ? ('exact' as const)
        : ('drift' as const);
    }),
  );
  if (observed.every((state) => state === 'absent')) return 'absent';
  if (observed.every((state) => state === 'exact')) return 'exact';
  throw new OperateError(
    'E_OPERATE_ROUTE_DRIFT',
    'A prepared route has partial or changed destination bytes; recover the journal before retrying.',
  );
}

async function buildRouteWrites(input: {
  projectRoot: string;
  route: OperatingRoutePlan;
  finding: Record<string, unknown>;
  config: OperatingConfig;
  now: string;
  localRoot?: string;
  artifactGeneration?: StoredOperatingArtifactGeneration;
}): Promise<BuiltRouteWrites> {
  const action = input.route.actions[0];
  if (!action?.targetPath) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      `Route ${input.route.id} has no target path.`,
    );
  }
  const title = sanitizeGeneratedPlainText(String(input.finding.title ?? action.findingId));
  const problem = sanitizeGeneratedPlainText(String(input.finding.problem ?? ''));
  const proposal = sanitizeGeneratedPlainText(String(input.finding.proposal ?? ''));
  if (action.kind === 'create-cycle-artifact') {
    const generationPlan = createOperatingArtifactGenerationPlan({
      cycleId: input.route.cycleId,
      destination: action.targetPath,
      evidenceRefs: action.evidenceRefs,
      title,
      proposal,
      problem,
    });
    if (!input.artifactGeneration) {
      return { writes: [], generationPlan };
    }
    if (input.artifactGeneration.planDigest !== generationPlan.planDigest) {
      throw new OperateError(
        'E_OPERATE_ROUTE_DRIFT',
        'The generated artifact no longer matches the accepted generation contract.',
      );
    }
    const writes = generatedArtifactWrites(input.artifactGeneration);
    const committedSession = input.artifactGeneration
      .session as unknown as OperatingArtifactSession;
    await assertOperatingArtifact('operating-artifact-session', committedSession);
    return {
      writes,
      artifactSession: committedSession,
      generationPlan,
    };
  }
  if (action.kind === 'create-decision') {
    return {
      writes: [
        {
          relativePath: action.targetPath,
          operation: 'create',
          content: `${canonicalize({
            id: input.route.id,
            cycleId: input.route.cycleId,
            findingId: action.findingId,
            owner: action.owner,
            question: problem,
            recommendation: proposal,
            evidenceRefs: action.evidenceRefs,
            status: 'open',
          })}\n`,
        },
      ],
    };
  }

  if (action.kind === 'create-epic') {
    // Rebuild the member list from the committed accepted findings so preview and
    // apply are byte-identical; the shared v1.3 route action stays single-anchor
    // (`findingId`), and the full membership lives only here, in the epic doc.
    const group = await resolveEpicGroupForAnchor({
      projectRoot: input.projectRoot,
      localRoot: input.localRoot,
      cycleId: input.route.cycleId,
      anchorId: action.findingId,
    });
    if (!group) {
      throw new OperateError(
        'E_OPERATE_TRANSACTION_INVALID',
        `Route ${input.route.id} no longer anchors a 2+-member accepted-finding group.`,
      );
    }
    const epicId = action.targetPath.match(/(?:^|\/)(EPIC-[0-9]+)(?:-|\.|\/)/)?.[1];
    if (!epicId) {
      throw new OperateError(
        'E_OPERATE_TRANSACTION_INVALID',
        'Epic route target does not encode a canonical EPIC id.',
      );
    }
    const memberList = group.members.map(
      (member) =>
        `${member.id}: ${sanitizeGeneratedPlainText(member.title)}${
          member.evidenceRefs.length > 0 ? ` (evidence: ${member.evidenceRefs.join(', ')})` : ''
        }`,
    );
    // Reuse the CLI's epic authoring seam (cli/commands/epic.ts → createArtifact →
    // renderTemplate on `epics/epic.md.hbs`). We render through the same template
    // for byte-identical epic shape, but emit the content into the write-ahead
    // journal instead of createArtifact's direct disk write, because a route must
    // be transactional and byte-exact reversible. `now` is the frozen route
    // timestamp so preview and apply agree.
    const content = await renderTemplate('epics/epic.md.hbs', {
      id: epicId,
      title: group.theme,
      owner: action.owner,
      date: input.now.slice(0, 10),
      projectName: path.basename(input.projectRoot),
      businessValue: `Consolidates ${group.memberIds.length} related accepted findings from operating cycle ${input.route.cycleId} into one themed epic so they are planned together.`,
      targetUsers: `Decision owner ${action.owner} and the planning team.`,
      problemStatement: `Related accepted findings ${group.memberIds.join(', ')} share the "${group.category}" theme surfaced by the Operating Board and warrant one coordinated epic.`,
      solutionOverview: sanitizeGeneratedPlainText(
        group.members
          .map((member) => member.proposal)
          .filter(Boolean)
          .join(' '),
      ),
      successCriteriaList: group.members.map(
        (member) =>
          `Address ${member.id} — ${sanitizeGeneratedPlainText(member.title)} — using its cited evidence${
            member.evidenceRefs.length > 0 ? `: ${member.evidenceRefs.join(', ')}` : ''
          }.`,
      ),
      keyFeatures: memberList,
      dependencies: `Operating cycle ${input.route.cycleId}; anchor finding ${group.anchorId}; evidence: ${group.evidenceRefs.join(', ')}.`,
      risks:
        'No security, privacy, payment-integrity, or tenant-isolation regression. PLAN and SHIP are never invoked automatically by this operating route.',
      featureIds: [],
    });
    return {
      writes: [
        {
          relativePath: action.targetPath,
          operation: 'create',
          content,
        },
      ],
    };
  }

  if (action.kind === 'create-quick-task') {
    const quickId = `QUICK-${action.id.slice('ACT-'.length)}`;
    const created = input.now.slice(0, 10);
    // Real `.planr/quick/QUICK-NNN-{slug}.md` file matching the existing
    // quick-task frontmatter shape (`storyId`/`featureId` optional, `status:
    // "pending"`). Provenance — the source cycle, finding, owner, and cited
    // evidence — is embedded exactly the way `create-decision` records it above.
    const quickTask = [
      '---',
      `id: ${JSON.stringify(quickId)}`,
      `title: ${JSON.stringify(title)}`,
      `created: ${JSON.stringify(created)}`,
      `updated: ${JSON.stringify(created)}`,
      'status: "pending"',
      `cycleId: ${JSON.stringify(input.route.cycleId)}`,
      `findingId: ${JSON.stringify(action.findingId)}`,
      `owner: ${JSON.stringify(action.owner)}`,
      `evidenceRefs: ${JSON.stringify([...action.evidenceRefs])}`,
      '---',
      '',
      `# ${quickId}: ${title}`,
      '',
      '## Context',
      problem,
      '',
      '## Tasks',
      `- [ ] ${proposal}`,
      '',
      '## Provenance',
      `Routed from Operating Board cycle ${input.route.cycleId}, finding ${action.findingId}, owned by ${action.owner}.`,
      ...(action.evidenceRefs.length > 0
        ? ['', 'Evidence:', ...action.evidenceRefs.map((reference) => `- ${reference}`)]
        : []),
      '',
      '## Notes',
      '_Small, bounded implementation work. Apply through your coding agent; PLAN and SHIP are never invoked automatically._',
      '',
    ].join('\n');
    return {
      writes: [
        {
          relativePath: action.targetPath,
          operation: 'create',
          content: quickTask,
        },
      ],
    };
  }

  const specId = action.targetPath.match(/(?:^|\/)(SPEC-\d+)(?:-|\/)/)?.[1];
  if (!specId) {
    throw new OperateError(
      'E_OPERATE_TRANSACTION_INVALID',
      'DEV route target does not encode a canonical SPEC id.',
    );
  }
  const ordinal = specId.slice('SPEC-'.length);
  const slug = slugify(title);
  const nowDate = new Date(input.now);
  const baselineTo = new Date(nowDate.getTime() - 1).toISOString();
  const baselineFrom = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const targetFrom = nowDate.toISOString();
  const targetTo = new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const verifyAfter = new Date(nowDate.getTime() + 31 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const sidecar: OperatingSpecLink = {
    kind: 'operating-spec-link',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    specId,
    sourceCycle: input.route.cycleId,
    sourceFinding: action.findingId,
    planningEngine: input.config.planningEngine,
    evidenceRefs: [...action.evidenceRefs],
    outcome: {
      kind: action.kind === 'create-instrumentation-spec' ? 'operational' : 'metric',
      metric: `validated completion of ${slug}`,
      unit: 'accepted-checks',
      queryIdentity: `openplanr.operate.${input.route.id.toLowerCase()}.v1`,
      direction: 'increase',
      operator: 'gte',
      aggregation: 'latest',
      baselineWindow: { from: baselineFrom, to: baselineTo },
      targetWindow: { from: targetFrom, to: targetTo },
      threshold: { value: 1 },
      minimumCoverage: 1,
      minimumSample: 1,
      stalePolicy: 'create-gap',
      missingPolicy: 'create-gap',
      guardrailPrecedence: 'block-on-breach',
      source: 'openplanr-operating-review',
      observationWindow: '30d',
      verifyAfter,
    },
    guardrails: ['No security, privacy, payment-integrity, or tenant-isolation regression.'],
    rollout: 'Implement through the reviewed PLAN artifact after owner acceptance.',
    rollback: 'Roll back the implementation; preserve this operating decision and its evidence.',
  };
  await assertOperatingArtifact('operating-spec-link', sidecar);
  const outcome: OperatingOutcome = {
    kind: 'operating-outcome',
    schemaVersion: OPERATE_SCHEMA_VERSION,
    protocolVersion: OPERATE_PROTOCOL_VERSION,
    id: `OUT-${ordinal}`,
    sourceCycle: input.route.cycleId,
    sourceFinding: action.findingId,
    specId,
    outcomeKind: sidecar.outcome.kind,
    metric: sidecar.outcome.metric,
    unit: sidecar.outcome.unit,
    queryIdentity: sidecar.outcome.queryIdentity,
    direction: sidecar.outcome.direction,
    operator: sidecar.outcome.operator,
    aggregation: sidecar.outcome.aggregation,
    baselineWindow: sidecar.outcome.baselineWindow,
    targetWindow: sidecar.outcome.targetWindow,
    threshold: sidecar.outcome.threshold,
    minimumCoverage: sidecar.outcome.minimumCoverage,
    minimumSample: sidecar.outcome.minimumSample,
    stalePolicy: sidecar.outcome.stalePolicy,
    missingPolicy: sidecar.outcome.missingPolicy,
    guardrailPrecedence: sidecar.outcome.guardrailPrecedence,
    guardrails: [],
    source: sidecar.outcome.source,
    observationWindow: sidecar.outcome.observationWindow,
    verifyAfter: sidecar.outcome.verifyAfter,
    rollout: sidecar.rollout,
    rollback: sidecar.rollback,
    status: 'pending',
    evidenceRefs: [...action.evidenceRefs],
    createdAt: input.now,
    updatedAt: input.now,
  };
  await assertOperatingArtifact('operating-outcome', outcome);
  const spec = [
    '---',
    `id: ${JSON.stringify(specId)}`,
    `title: ${JSON.stringify(title)}`,
    `slug: ${JSON.stringify(slug)}`,
    'schemaVersion: "1.0.0"',
    'status: "shaping"',
    'priority: "P1"',
    `created: ${JSON.stringify(input.now.slice(0, 10))}`,
    `updated: ${JSON.stringify(input.now.slice(0, 10))}`,
    'ui_files: []',
    'tech_dependencies: []',
    '---',
    '',
    `# ${specId} — ${title}`,
    '',
    '## Context',
    problem,
    '',
    '## Proposed outcome',
    proposal,
    '',
    '## Functional requirements',
    '- Preserve current behavior outside the explicitly reviewed scope.',
    '- Implement the evidence-backed proposal and satisfy the outcome contract.',
    '',
    '## Evidence',
    ...action.evidenceRefs.map((reference) => `- ${reference}`),
    '',
    '## Acceptance criteria',
    `- The implementation satisfies ${sidecar.outcome.metric}.`,
    '- No listed operating guardrail regresses.',
    '- PLAN artifacts receive human review before any SHIP invocation.',
    '',
    '## Preserve',
    '- Existing hand-written project instructions and unrelated planning artifacts.',
    '',
  ].join('\n');
  const handoff = {
    operationId: input.route.id,
    cycleId: input.route.cycleId,
    findingId: action.findingId,
    specId,
    planningEngine: input.config.planningEngine,
    state: 'awaiting-plan',
    invocation:
      input.config.planningEngine === 'pipeline-po'
        ? `planr pipeline plan ${JSON.stringify(slug)} --runtime auto`
        : `planr spec decompose ${specId}`,
    pipelinePreparation: {
      required: input.config.planningEngine === 'pipeline-po',
      api: input.config.planningEngine === 'pipeline-po' ? 'preparePlan' : null,
      completeApi: input.config.planningEngine === 'pipeline-po' ? 'completePlan' : null,
    },
    shipInvoked: false,
    evidenceRefs: action.evidenceRefs,
    inputDigest: input.route.inputDigest,
  };
  return {
    writes: [
      { relativePath: action.targetPath, operation: 'create', content: spec },
      {
        relativePath: `.planr/operate/spec-links/${specId}.json`,
        operation: 'create',
        content: `${canonicalize(sidecar)}\n`,
      },
      {
        relativePath: `.planr/operate/outcomes/OUT-${ordinal}.json`,
        operation: 'create',
        content: `${canonicalize(outcome)}\n`,
      },
      {
        relativePath: `.planr/operate/handoffs/${input.route.id}.json`,
        operation: 'create',
        content: `${canonicalize(handoff)}\n`,
      },
    ],
    specLink: sidecar,
    outcome,
  };
}

export async function applyOperatingRoute(input: {
  projectRoot: string;
  route: OperatingRoutePlan;
  config: OperatingConfig;
  confirmationDigest: string;
  localRoot?: string;
  artifactGenerator?: OperatingArtifactGeneratorAdapter;
  faultInjector?: (
    boundary:
      | 'artifact-attempt-failed'
      | 'artifact-generated'
      | 'bytes-committed'
      | 'spec-linked'
      | 'outcome-registered'
      | 'artifact-created',
  ) => void | Promise<void>;
}): Promise<{
  transactionId?: string;
  eventHead: OperatingEventHead;
  state: 'awaiting-artifact-review' | 'awaiting-plan' | 'applied';
  invocation?: string;
  previewDigest?: `sha256:${string}`;
  artifact?: {
    destination: string;
    content: string;
    outputDigest: `sha256:${string}`;
    attempts: StoredOperatingArtifactGeneration['attempts'];
  };
  shipInvoked: false;
}> {
  const isAgentArtifact = input.route.actions[0]?.kind === 'create-cycle-artifact';
  const existingGeneration = isAgentArtifact
    ? await readStoredOperatingArtifactGeneration({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        route: input.route,
      })
    : null;
  const acceptedApplyDigest =
    input.confirmationDigest === input.route.previewDigest ||
    (existingGeneration?.state === 'generated' &&
      input.confirmationDigest === existingGeneration.exactPreviewDigest);
  if (!acceptedApplyDigest) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Route application requires confirmation of the exact preview digest.',
      {
        previewDigest:
          existingGeneration?.state === 'generated'
            ? existingGeneration.exactPreviewDigest
            : input.route.previewDigest,
      },
    );
  }
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  const initialState = await store.state();
  const projectedRoute = initialState.routes.find((route) => route.id === input.route.id);
  const finding = initialState.findings.find(
    (candidate) => candidate.id === input.route.actions[0]?.findingId,
  );
  if (!finding) {
    throw new OperateError(
      'E_OPERATE_STATE_INVALID',
      `Route ${input.route.id} references an unknown finding.`,
    );
  }
  const acceptedConfirmation = projectedRoute?.confirmationDigest;
  if (projectedRoute?.state === 'applied' && projectedRoute.transactionId) {
    return {
      transactionId: String(projectedRoute.transactionId),
      eventHead: initial.eventHead,
      state: 'applied',
      shipInvoked: false,
    };
  }
  if (
    !['accepted', 'prepared'].includes(String(projectedRoute?.state)) ||
    typeof acceptedConfirmation !== 'string'
  ) {
    throw new OperateError(
      'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED',
      'Route must be accepted or recoverably prepared before it can be applied.',
    );
  }
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      await assertRouteWorkspaceCurrent(input);
      let preparedHead = initial.eventHead;
      if (projectedRoute?.state === 'accepted') {
        const preparedEvent = await store.append({
          type: 'route.prepared',
          cycleId: input.route.cycleId,
          entityId: input.route.id,
          payload: {
            routeDigest: input.route.routeDigest,
            previewDigest: input.route.previewDigest,
          },
          expectedHead: initial.eventHead.hash,
        });
        preparedHead = {
          sequence: preparedEvent.sequence,
          hash: preparedEvent.eventHash,
        };
        await lock.advanceEventHead(initial.eventHead, preparedHead);
      }
      let committedTransaction: Awaited<ReturnType<typeof prepareJournalTransaction>> | null = null;
      let routeApplied = false;
      let bytesCommitted = false;
      try {
        let artifactGeneration = isAgentArtifact
          ? await readStoredOperatingArtifactGeneration({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              route: input.route,
            })
          : null;
        let built = await buildRouteWrites({
          projectRoot: input.projectRoot,
          route: input.route,
          finding,
          config: input.config,
          now: input.route.createdAt,
          localRoot: input.localRoot,
          ...(artifactGeneration?.state === 'generated' ? { artifactGeneration } : {}),
        });
        const plannedDigest = routeWritesPreviewDigest(
          input.route.inputDigest,
          built.writes,
          built.generationPlan?.planDigest,
        );
        if (!built.generationPlan && plannedDigest !== input.route.previewDigest) {
          throw new OperateError(
            'E_OPERATE_ROUTE_DRIFT',
            'The exact route write set no longer matches the accepted preview.',
          );
        }
        if (built.generationPlan) {
          const initialGenerationDigest = routeWritesPreviewDigest(
            input.route.inputDigest,
            [],
            built.generationPlan.planDigest,
          );
          if (initialGenerationDigest !== input.route.previewDigest) {
            throw new OperateError(
              'E_OPERATE_ROUTE_DRIFT',
              'The artifact generation contract no longer matches the accepted route.',
            );
          }
          if (artifactGeneration?.state !== 'generated') {
            artifactGeneration = await generateOperatingRouteArtifact({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              route: input.route,
              plan: built.generationPlan,
              adapter:
                input.artifactGenerator ??
                (await resolveOperatingArtifactGenerator({
                  projectRoot: input.projectRoot,
                  route: input.route,
                  localRoot: input.localRoot,
                })),
              now: input.route.createdAt,
              onAttemptFailed: async () => {
                await input.faultInjector?.('artifact-attempt-failed');
              },
            });
            await input.faultInjector?.('artifact-generated');
            built = await buildRouteWrites({
              projectRoot: input.projectRoot,
              route: input.route,
              finding,
              config: input.config,
              now: input.route.createdAt,
              localRoot: input.localRoot,
              artifactGeneration,
            });
          }
          if (artifactGeneration.state !== 'generated' || !artifactGeneration.exactPreviewDigest) {
            throw new OperateError(
              'E_OPERATE_ARTIFACT_REJECTED',
              'The AGENT artifact is not ready for exact-byte review.',
            );
          }
          const exactDigest = routeWritesPreviewDigest(
            input.route.inputDigest,
            built.writes,
            built.generationPlan?.planDigest,
          );
          if (
            exactDigest !== artifactGeneration.exactPreviewDigest ||
            input.confirmationDigest !== artifactGeneration.exactPreviewDigest
          ) {
            const preparedState = await store.state();
            await store.writeCheckpoint(preparedState);
            await persistOperatingProjections({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              state: preparedState,
              revalidateEventHead: async () => (await store.replay()).eventHead,
            });
            return {
              eventHead: preparedHead,
              state: 'awaiting-artifact-review',
              previewDigest: artifactGeneration.exactPreviewDigest,
              artifact: {
                destination: artifactGeneration.session.destination,
                content: artifactGeneration.content as string,
                outputDigest: artifactGeneration.session.outputDigest as `sha256:${string}`,
                attempts: artifactGeneration.attempts,
              },
              shipInvoked: false,
            };
          }
        }
        await assertRouteWorkspaceCurrent(input);
        const transactionPreviewDigest =
          isAgentArtifact && artifactGeneration?.state === 'generated'
            ? (artifactGeneration.exactPreviewDigest as `sha256:${string}`)
            : input.route.previewDigest;
        const transactionId = `TXN-${input.route.id}-${transactionPreviewDigest.slice(7, 23)}`;
        const materialState = await routeWriteMaterialState(input.projectRoot, built.writes);
        const transaction =
          materialState === 'exact'
            ? {
                root: path.join(
                  resolveOperatingPaths(input.projectRoot, {
                    localRoot: input.localRoot,
                  }).transactions,
                  transactionId,
                ),
                manifestPath: path.join(
                  resolveOperatingPaths(input.projectRoot, {
                    localRoot: input.localRoot,
                  }).transactions,
                  transactionId,
                  'journal.json',
                ),
                record: await readJournal(
                  path.join(
                    resolveOperatingPaths(input.projectRoot, {
                      localRoot: input.localRoot,
                    }).transactions,
                    transactionId,
                    'journal.json',
                  ),
                ),
              }
            : await prepareJournalTransaction(input.projectRoot, {
                writes: built.writes,
                eventHead: preparedHead,
                previewDigest: transactionPreviewDigest,
                transactionId,
                localRoot: input.localRoot,
              });
        if (materialState === 'exact' && transaction.record.state !== 'committed') {
          throw new OperateError(
            'E_OPERATE_TRANSACTION_INVALID',
            'Prepared route bytes exist without a committed journal.',
          );
        }
        if (materialState === 'absent') {
          await applyJournalTransaction(input.projectRoot, transaction, {
            currentEventHead: preparedHead,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          });
        }
        committedTransaction = transaction;
        bytesCommitted = true;
        await input.faultInjector?.('bytes-committed');
        if (built.specLink) {
          const handoff = await ensurePlanningHandoff({
            projectRoot: input.projectRoot,
            localRoot: input.localRoot,
            route: input.route,
            config: input.config,
            finding,
            transactionId: transaction.record.transactionId,
          });
          const planCompleted = await completePlanningHandoffIfReady({
            projectRoot: input.projectRoot,
            handoff,
          });
          if (!planCompleted) {
            const preparedState = await store.state();
            await store.writeCheckpoint(preparedState);
            await persistOperatingProjections({
              projectRoot: input.projectRoot,
              localRoot: input.localRoot,
              state: preparedState,
              revalidateEventHead: async () => (await store.replay()).eventHead,
            });
            return {
              transactionId: transaction.record.transactionId,
              eventHead: preparedHead,
              state: 'awaiting-plan',
              invocation: handoff.invocation,
              shipInvoked: false,
            };
          }
        }
        let finalHead = preparedHead;
        const refreshedState = await store.state();
        if (
          built.specLink &&
          !refreshedState.specLinks.some((link) => link.specId === built.specLink?.specId)
        ) {
          const linked = await store.append({
            type: 'spec.linked',
            cycleId: input.route.cycleId,
            entityId: built.specLink.specId,
            evidenceRefs: built.specLink.evidenceRefs,
            payload: { record: built.specLink },
            expectedHead: finalHead.hash,
          });
          const linkedHead = {
            sequence: linked.sequence,
            hash: linked.eventHash,
          } satisfies OperatingEventHead;
          await lock.advanceEventHead(finalHead, linkedHead);
          finalHead = linkedHead;
          await input.faultInjector?.('spec-linked');
        }
        const stateBeforeOutcome = await store.state();
        if (
          built.outcome &&
          !stateBeforeOutcome.outcomes.some((outcome) => outcome.id === built.outcome?.id)
        ) {
          const registered = await store.append({
            type: 'outcome.registered',
            cycleId: input.route.cycleId,
            entityId: built.outcome.id,
            evidenceRefs: built.outcome.evidenceRefs,
            payload: { record: built.outcome },
            expectedHead: finalHead.hash,
          });
          const registeredHead = {
            sequence: registered.sequence,
            hash: registered.eventHash,
          } satisfies OperatingEventHead;
          await lock.advanceEventHead(finalHead, registeredHead);
          finalHead = registeredHead;
          await input.faultInjector?.('outcome-registered');
        }
        const replayBeforeArtifact = await store.replay();
        if (
          built.artifactSession &&
          !replayBeforeArtifact.events.some(
            (event) =>
              event.type === 'artifact.created' && event.entityId === built.artifactSession?.id,
          )
        ) {
          const artifactRecord = await store.putRecord(
            'artifact-manifest',
            built.artifactSession as unknown as Record<string, unknown>,
            {
              correlationId: input.route.id,
              createdAt: input.route.createdAt,
            },
          );
          const created = await store.append({
            type: 'artifact.created',
            cycleId: input.route.cycleId,
            entityId: built.artifactSession.id,
            evidenceRefs: built.artifactSession.evidenceRefs,
            payload: { recordDigest: artifactRecord.digest },
            expectedHead: finalHead.hash,
          });
          const createdHead = {
            sequence: created.sequence,
            hash: created.eventHash,
          } satisfies OperatingEventHead;
          await lock.advanceEventHead(finalHead, createdHead);
          finalHead = createdHead;
          await input.faultInjector?.('artifact-created');
        }
        const applied = await store.append({
          type: 'route.applied',
          cycleId: input.route.cycleId,
          entityId: input.route.id,
          payload: {
            routeDigest: input.route.routeDigest,
            confirmationDigest: acceptedConfirmation,
            transactionId: transaction.record.transactionId,
          },
          expectedHead: finalHead.hash,
        });
        const appliedHead = {
          sequence: applied.sequence,
          hash: applied.eventHash,
        } satisfies OperatingEventHead;
        await lock.advanceEventHead(finalHead, appliedHead);
        finalHead = appliedHead;
        routeApplied = true;
        const appliedState = await store.state();
        await store.writeCheckpoint(appliedState);
        await persistOperatingProjections({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          state: appliedState,
          revalidateEventHead: async () => (await store.replay()).eventHead,
        });
        return {
          transactionId: transaction.record.transactionId,
          eventHead: finalHead,
          state: 'applied',
          shipInvoked: false,
        };
      } catch (error) {
        if (committedTransaction && !bytesCommitted && !routeApplied) {
          await rollbackJournalTransaction(input.projectRoot, committedTransaction).catch(
            () => undefined,
          );
        }
        if (routeApplied || bytesCommitted || isAgentArtifact) {
          const interruptedState = await store.state();
          await store.writeCheckpoint(interruptedState).catch(() => undefined);
          await persistOperatingProjections({
            projectRoot: input.projectRoot,
            localRoot: input.localRoot,
            state: interruptedState,
            revalidateEventHead: async () => (await store.replay()).eventHead,
          }).catch(() => undefined);
          throw error;
        }
        const current = (await store.replay()).eventHead;
        const errorCode =
          error instanceof OperateError ? error.code : 'E_OPERATE_TRANSACTION_INVALID';
        const failed = await store.append({
          type: 'route.failed',
          cycleId: input.route.cycleId,
          entityId: input.route.id,
          payload: {
            routeDigest: input.route.routeDigest,
            errorCode,
          },
          expectedHead: current.hash,
        });
        const failedHead = {
          sequence: failed.sequence,
          hash: failed.eventHash,
        } satisfies OperatingEventHead;
        await lock.advanceEventHead(current, failedHead);
        const failedState = await store.state();
        await store.writeCheckpoint(failedState);
        await persistOperatingProjections({
          projectRoot: input.projectRoot,
          localRoot: input.localRoot,
          state: failedState,
          revalidateEventHead: async () => (await store.replay()).eventHead,
        });
        throw error;
      }
    },
  );
}

export async function rollbackOperatingRoute(input: {
  projectRoot: string;
  route: OperatingRoutePlan;
  transactionId: string;
  recoveryId: string;
  localRoot?: string;
}): Promise<OperatingEventHead> {
  const store = new OperatingEventStore(input.projectRoot, { localRoot: input.localRoot });
  const initial = await store.replay();
  return withOperatingLock(
    input.projectRoot,
    {
      projectKey: operatingProjectKey(input.projectRoot),
      expectedEventHead: initial.eventHead,
      currentEventHead: initial.eventHead,
      localRoot: input.localRoot,
    },
    async (lock) => {
      const state = await store.state();
      const projected = state.routes.find((route) => route.id === input.route.id);
      if (
        !projected ||
        !['applied', 'failed'].includes(projected.state) ||
        projected.transactionId !== input.transactionId
      ) {
        throw new OperateError(
          'E_OPERATE_ROUTE_DRIFT',
          'The route projection no longer matches the rollback transaction.',
        );
      }
      const paths = resolveOperatingPaths(input.projectRoot, { localRoot: input.localRoot });
      const root = path.join(paths.transactions, input.transactionId);
      const manifestPath = path.join(root, 'journal.json');
      const record = await readJournal(manifestPath);
      const revalidated = await store.replay();
      if (
        revalidated.eventHead.sequence !== initial.eventHead.sequence ||
        revalidated.eventHead.hash !== initial.eventHead.hash
      ) {
        throw new OperateError(
          'E_OPERATE_HEAD_DIVERGED',
          'Operating state changed before route rollback.',
        );
      }
      await rollbackJournalTransaction(input.projectRoot, { root, manifestPath, record });
      const event = await store.append({
        type: 'route.rolled_back',
        cycleId: input.route.cycleId,
        entityId: input.route.id,
        payload: {
          routeDigest: input.route.routeDigest,
          recoveryId: input.recoveryId,
        },
        expectedHead: initial.eventHead.hash,
      });
      const next = { sequence: event.sequence, hash: event.eventHash };
      await lock.advanceEventHead(initial.eventHead, next);
      const rolledBackState = await store.state();
      await store.writeCheckpoint(rolledBackState);
      await persistOperatingProjections({
        projectRoot: input.projectRoot,
        localRoot: input.localRoot,
        state: rolledBackState,
        revalidateEventHead: async () => (await store.replay()).eventHead,
      });
      return next;
    },
  );
}

export async function routeDestinationDigest(
  projectRoot: string,
  route: OperatingRoutePlan,
): Promise<`sha256:${string}`> {
  const destinations = await Promise.all(
    routeDestinationPaths(route).map(async (relativePath) => {
      const target = await resolveContainedPath(projectRoot, relativePath);
      const content = await readFile(target).catch(() => null);
      return {
        path: relativePath,
        beforeDigest: content ? sha256Digest(content) : null,
      };
    }),
  );
  return canonicalDigest(destinations);
}
